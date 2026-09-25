import { AndroidDevice, AndroidDeviceStatus } from '@/entities/AndroidDevice';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { ConfirmPairingValidation, RequestPairingCodeValidation } from '@/validations/AndroidDeviceValidation';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Service } from 'typedi';
import { z } from 'zod';
import envConfig from '@/config/envConfig';

@Service()
export class AndroidDeviceService {
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  /**
   * Generates a 6-character pairing code valid for 10 minutes.
   */
  async requestPairingCode(request: z.infer<typeof RequestPairingCodeValidation>, userId: number): Promise<ApiResponse> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const tempDeviceId = `pending_${crypto.randomUUID()}`;

    const device = this.deviceRepo.create({
      user_id: userId,
      device_id: tempDeviceId,
      device_name: request.device_name,
      device_model: request.device_model || 'Android Device',
      pairing_code: code,
      pairing_expires_at: expiresAt,
      status: AndroidDeviceStatus.OFFLINE,
    });

    await this.deviceRepo.save(device);

    return {
      message: 'Pairing code generated successfully',
      data: {
        pairingCode: code,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  /**
   * Confirms pairing from the Android Companion app.
   * Generates and returns a persistent device token.
   */
  async confirmPairing(request: z.infer<typeof ConfirmPairingValidation>): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({
      where: { pairing_code: request.pairing_code },
    });

    if (!device) {
      throw new AppError('Invalid or expired pairing code', 400);
    }

    if (!device.pairing_expires_at || new Date() > new Date(device.pairing_expires_at)) {
      throw new AppError('Pairing code has expired. Please generate a new one from the dashboard.', 400);
    }

    // A physical companion can move between accounts, but only its own owner may
    // release it: if this hardware ID already belongs to a DIFFERENT account, we
    // refuse rather than silently delete that account's device. Otherwise anyone
    // who learns a victim's hardware ID could pair with it and wipe their device
    // row. Re-pairing within the same account still replaces the old record.
    const previousDevice = await this.deviceRepo.findOne({ where: { device_id: request.device_id } });
    if (previousDevice && previousDevice.id !== device.id) {
      if (previousDevice.user_id !== device.user_id) {
        throw new AppError('This device is already paired to another account. Unpair it there first.', 409);
      }
      await this.deviceRepo.remove(previousDevice);
    }

    // Generate permanent device token
    const secret = process.env.JWT_SECRET || 'vector-android-secret';
    const deviceToken = jwt.sign(
      {
        deviceId: request.device_id,
        userId: device.user_id,
        type: 'android_companion',
      },
      secret,
      { expiresIn: '365d' },
    );

    // Update device record with real hardware details and token
    device.device_id = request.device_id;
    device.device_name = request.device_name;
    device.device_model = request.device_model || device.device_model;
    device.android_version = request.android_version || 'Android 14+';
    device.device_token = deviceToken;
    device.pairing_code = null;
    device.pairing_expires_at = null;
    device.status = AndroidDeviceStatus.ONLINE;
    device.last_seen_at = new Date();
    device.capabilities = {
      accessibility: request.capabilities?.accessibility ?? true,
      screenCapture: request.capabilities?.screenCapture ?? true,
      screenWidth: request.capabilities?.screenWidth,
      screenHeight: request.capabilities?.screenHeight,
    };

    await this.deviceRepo.save(device);

    return {
      message: 'Device paired successfully',
      data: {
        deviceId: device.device_id,
        deviceToken,
        deviceName: device.device_name,
      },
    };
  }

  /**
   * List all paired devices for a specific user.
   */
  async listUserDevices(userId: number): Promise<ApiResponse> {
    const devices = await this.deviceRepo.find({
      where: { user_id: userId },
      // Stable order by when the device was first paired, NOT updated_at. Every
      // heartbeat bumps updated_at, so an updated_at sort made cards jump around
      // on each poll as different phones checked in — impossible to find a phone.
      // created_at never changes, so a card keeps its place.
      order: { created_at: 'ASC' },
    });

    // Filter out pending unpaired devices
    const paired = devices.filter((d) => !d.device_id.startsWith('pending_'));

    return {
      message: 'User devices retrieved successfully',
      data: paired,
    };
  }

  /**
   * Get single device details.
   */
  async getDeviceById(id: number, userId: number): Promise<AndroidDevice> {
    const device = await this.deviceRepo.findOne({
      where: { id, user_id: userId },
    });

    if (!device) {
      throw new AppError('Device not found', 404);
    }

    return device;
  }

  /**
   * Find device by hardware deviceId.
   */
  async getDeviceByHardwareId(deviceId: string): Promise<AndroidDevice | null> {
    return this.deviceRepo.findOne({
      where: { device_id: deviceId },
    });
  }

  /**
   * Update device status (e.g. ONLINE / OFFLINE / BUSY).
   */
  async updateDeviceStatus(deviceId: string, status: AndroidDeviceStatus, capabilities?: any): Promise<void> {
    const device = await this.deviceRepo.findOne({ where: { device_id: deviceId } });
    if (device) {
      device.status = status;
      device.last_seen_at = new Date();
      if (capabilities) {
        device.capabilities = { ...device.capabilities, ...capabilities };
      }
      await this.deviceRepo.save(device);
    }
  }

  /**
   * Unpair and delete a device.
   */
  /** Set or clear the user's own note on a device. */
  async setDeviceTag(id: number, userId: number, tag: string): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({ where: { id, user_id: userId } });
    if (!device) {
      throw new AppError('Device not found', 404);
    }

    const trimmed = tag.trim();
    device.tag = trimmed.length > 0 ? trimmed : null;
    await this.deviceRepo.save(device);

    return { message: trimmed ? 'Tag saved' : 'Tag removed', data: { id: device.id, tag: device.tag } };
  }

  async renameDevice(id: number, userId: number, deviceName: string): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({
      where: { id, user_id: userId },
    });

    if (!device) {
      throw new AppError('Device not found', 404);
    }

    device.device_name = deviceName;
    await this.deviceRepo.save(device);

    return { message: 'Device renamed successfully', data: { id: device.id, device_name: device.device_name } };
  }

  async unpairDevice(id: number, userId: number): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({
      where: { id, user_id: userId },
    });

    if (!device) {
      throw new AppError('Device not found', 404);
    }

    await this.deviceRepo.remove(device);
    return { message: 'Device unpaired successfully' };
  }

  /**
   * Removes every OFFLINE device for a user in one call.
   *
   * The reinstall bug used to mint a fresh id per install, leaving a trail of
   * orphaned offline rows that could only be deleted one at a time. This clears
   * them together. ONLINE devices are never touched, so a phone that is simply
   * asleep-but-connected is safe.
   */
  async deleteOfflineDevices(userId: number): Promise<ApiResponse> {
    const offline = await this.deviceRepo.find({
      where: { user_id: userId, status: AndroidDeviceStatus.OFFLINE },
    });
    if (offline.length > 0) {
      await this.deviceRepo.remove(offline);
    }
    return { message: `Removed ${offline.length} offline device${offline.length === 1 ? '' : 's'}`, data: { removed: offline.length } };
  }
}
