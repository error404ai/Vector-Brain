import { CryptoHelper } from '@/helpers/CryptoHelper';
import { CreateAiConfigValidation } from '@/validations/AiConfigValidation';
import { AiConfigType, AiProvider } from '@/entities/AiConfig';

describe('AiConfig and CryptoHelper tests', () => {
  describe('CryptoHelper AES-256-GCM encryption & decryption', () => {
    it('encrypts and decrypts sensitive API keys accurately', () => {
      const originalKey = 'sk-proj-test-1234567890-abcdefghijklmnop';
      const encrypted = CryptoHelper.encryptAesGcm(originalKey);

      expect(encrypted).not.toEqual(originalKey);
      expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:ciphertext

      const decrypted = CryptoHelper.decryptAesGcm(encrypted);
      expect(decrypted).toEqual(originalKey);
    });

    it('rejects tampered ciphertexts', () => {
      const originalKey = 'sk-ant-test-key-12345';
      const encrypted = CryptoHelper.encryptAesGcm(originalKey);
      const [iv, authTag, ciphertext] = encrypted.split(':');
      const tampered = `${iv}:${authTag}:${ciphertext.slice(0, -2)}ff`;

      expect(() => CryptoHelper.decryptAesGcm(tampered)).toThrow();
    });
  });

  describe('CreateAiConfigValidation', () => {
    it('validates a valid OpenAI configuration', () => {
      const validPayload = {
        provider: AiProvider.OPENAI,
        model: 'gpt-4o-mini',
        api_key: 'sk-test-12345',
        is_active: true,
        label: 'My OpenAI Model',
        config_type: AiConfigType.VISION,
      };

      const parsed = CreateAiConfigValidation.safeParse(validPayload);
      expect(parsed.success).toBe(true);
    });

    it('validates custom base URLs', () => {
      const customPayload = {
        provider: AiProvider.DEEPSEEK,
        model: 'deepseek-chat',
        api_key: 'sk-deepseek-test',
        base_url: 'https://api.deepseek.com/v1',
        is_active: false,
        config_type: AiConfigType.TEXT,
      };

      const parsed = CreateAiConfigValidation.safeParse(customPayload);
      expect(parsed.success).toBe(true);
    });

    it('rejects invalid URLs in base_url', () => {
      const invalidPayload = {
        provider: AiProvider.OPENAI,
        model: 'gpt-4o',
        api_key: 'sk-test',
        base_url: 'not-a-valid-url',
      };

      const parsed = CreateAiConfigValidation.safeParse(invalidPayload);
      expect(parsed.success).toBe(false);
    });
  });
});
