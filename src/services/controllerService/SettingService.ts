import { Service } from 'typedi';
import { FindOptionsWhere } from 'typeorm';
import z from 'zod';
import { DEFAULT_SETTINGS, DEFAULT_SETTINGS_VALUE_TYPE_MAP, SETTING_KEYS } from '../../config/defaultSettings';
import Setting from '../../entities/Setting';
import { AppDataSource } from '../../loaders/database';
import { SettingUpsertValidation } from '../../validations/SettingValidation';

@Service()
export default class SettingService {
  private get settingRepo() {
    const repo = AppDataSource.getRepository(Setting);
    (repo as any).manager = AppDataSource.manager;
    return repo;
  }

  private convertToStorageValue(value: string | boolean, key: string): string {
    const valueType = DEFAULT_SETTINGS_VALUE_TYPE_MAP.get(key);

    if (valueType === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new Error(`Setting '${key}' expects a boolean value`);
      }
      return value.toString();
    } else if (valueType === 'json') {
      if (typeof value !== 'string') {
        throw new Error(`Setting '${key}' expects a string value for JSON`);
      }
      try {
        JSON.parse(value);
      } catch {
        throw new Error(`Setting '${key}' expects valid JSON`);
      }
      return value;
    } else {
      if (typeof value !== 'string') {
        throw new Error(`Setting '${key}' expects a string value`);
      }
      return value;
    }
  }

  private convertFromStorageValue(value: string, key: string): string | boolean | object {
    const valueType = DEFAULT_SETTINGS_VALUE_TYPE_MAP.get(key);

    switch (valueType) {
      case 'boolean':
        return value === 'true';
      case 'json':
        return JSON.parse(value);
      default:
        return value;
    }
  }

  async createOrUpdate(request: z.infer<typeof SettingUpsertValidation>) {
    const settingGroup = this.getDefaultGroupForKey(request.key);
    const valueType = this.getDefaultValueTypeForKey(request.key);

    const defaultSetting = DEFAULT_SETTINGS.find((s) => s.key === request.key);
    if (!defaultSetting) {
      throw new Error(`Default setting not found for key: ${request.key}`);
    }

    if (valueType === 'json') {
      const defaultParsed = JSON.parse(defaultSetting.value);
      const providedParsed = JSON.parse(request.value as string);
      // Simplified structure check
      if (typeof defaultParsed !== typeof providedParsed) {
        throw new Error(`JSON structure for '${request.key}' does not match the default structure`);
      }
    }

    const storageValue = this.convertToStorageValue(request.value, request.key);

    const whereCondition: FindOptionsWhere<Setting> = {
      key: request.key,
      organization_id: 1,
      group: settingGroup,
    };

    const existingSetting = await this.settingRepo.findOne({
      where: whereCondition,
    });

    let isCreated = false;
    let settingData: Setting;

    if (existingSetting) {
      existingSetting.value = storageValue;
      existingSetting.value_type = valueType;
      settingData = await this.settingRepo.save(existingSetting);
    } else {
      const newSetting = this.settingRepo.create({
        key: request.key,
        value: storageValue,
        value_type: valueType,
        organization_id: 1,
        group: settingGroup,
      });
      settingData = await this.settingRepo.save(newSetting);
      isCreated = true;
    }

    return {
      status: true,
      message: isCreated ? 'Setting created successfully' : 'Setting updated successfully',
      data: settingData,
    };
  }

  async get(key: string): Promise<{
    key: string;
    value: string | boolean | object;
    group: string;
    title: string;
  }> {
    const group = this.getDefaultGroupForKey(key);

    const row = await this.settingRepo.findOne({
      where: {
        key,
        organization_id: 1,
        group,
      },
    });

    const defaultSetting = DEFAULT_SETTINGS.find((s) => s.key === key);
    if (!defaultSetting) {
      throw new Error(`Default setting not found for key: ${key}`);
    }

    if (row) {
      const value = this.convertFromStorageValue(row.value, row.key);
      return {
        key: row.key,
        value,
        group: row.group,
        title: defaultSetting.title,
      };
    } else {
      const value = this.convertFromStorageValue(defaultSetting.value, defaultSetting.key);
      return {
        key: defaultSetting.key,
        value,
        group: defaultSetting.group,
        title: defaultSetting.title,
      };
    }
  }

  async list(): Promise<
    Array<{
      title: string;
      key: string;
      value: string | boolean | object;
      group: string;
    }>
  > {
    const dbSettings = await this.settingRepo.find({
      where: { organization_id: 1 },
    });

    const dbMap = new Map<string, Setting>();
    for (const setting of dbSettings) {
      if (SETTING_KEYS.includes(setting.key)) {
        dbMap.set(setting.key, setting);
      }
    }

    return DEFAULT_SETTINGS.map((s) => {
      const dbSetting = dbMap.get(s.key);
      return {
        title: s.title,
        key: s.key,
        value: dbSetting ? this.convertFromStorageValue(dbSetting.value, dbSetting.key) : this.convertFromStorageValue(s.value, s.key),
        group: s.group,
      };
    });
  }

  private getDefaultGroupForKey(key: string): string {
    const setting = DEFAULT_SETTINGS.find((s) => s.key === key);
    return setting?.group || 'general';
  }

  private getDefaultValueTypeForKey(key: string): 'string' | 'boolean' | 'json' {
    const valueType = DEFAULT_SETTINGS_VALUE_TYPE_MAP.get(key);
    return valueType || 'string';
  }

  async getSettingValue<K extends (typeof SETTING_KEYS)[number]>(key: K): Promise<string | boolean | object> {
    const row = await this.settingRepo.findOne({
      where: {
        key,
        organization_id: 1,
        group: this.getDefaultGroupForKey(key),
      },
    });

    if (row) return this.convertFromStorageValue(row.value, key);
    const defaultSetting = DEFAULT_SETTINGS.find((s) => s.key === key);
    if (!defaultSetting) throw new Error(`Default setting not found for key: ${key}`);
    return this.convertFromStorageValue(defaultSetting.value, key);
  }
}
