import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('should return status ok with a valid timestamp', () => {
      const result = appController.health();

      expect(result.status).toBe('ok');
      expect(new Date(result.ts).toISOString()).toBe(result.ts);
    });
  });
});
