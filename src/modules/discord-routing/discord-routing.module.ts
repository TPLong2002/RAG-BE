import { Module } from '@nestjs/common';
import { DiscordRoutingTestController } from './discord-routing-test.controller';
import { DiscordRoutingTestService } from './discord-routing-test.service';

// ============================================================
// Module test cho Discord routing — chỉ chứa API mock, không DB.
// ============================================================

@Module({
  controllers: [DiscordRoutingTestController],
  providers: [DiscordRoutingTestService],
  exports: [DiscordRoutingTestService],
})
export class DiscordRoutingModule {}
