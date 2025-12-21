import Setting from '@/entities/Setting';
import { DEFAULT_SETTINGS } from '@/config/defaultSettings';
import { DataSource } from 'typeorm';

export const settingSeed = async (connection: DataSource) => {
  const settingRepo = connection.getRepository(Setting);
  const settingCount = await settingRepo.count();
  if (settingCount < 1) {
    const settingsToSeed = DEFAULT_SETTINGS.map((s) => ({
      key: s.key,
      value: s.value,
      value_type: s.value_type,
      organization_id: 1,
      group: s.group,
    }));
    await settingRepo.save(settingsToSeed);
    console.log('✅ Setting seed data has been added!');
  }
};