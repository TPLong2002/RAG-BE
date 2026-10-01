import { Body, Controller, Get, HttpException, HttpStatus, Post } from '@nestjs/common';
import { DiscordRoutingTestService } from './discord-routing-test.service';
import {
  BuildMatchRuleDto,
  CheckMatchDto,
  ResolveChannelsDto,
} from './dto/discord-routing-test.dto';
import { MOCK_CHANNELS, MOCK_FEATURES } from './discord-routing-mock.data';

// ============================================================
// CONTROLLER TEST — chạy trên mock data, không cần DB.
//   Base path: /api/discord-routing/test
// ============================================================

@Controller('api/discord-routing/test')
export class DiscordRoutingTestController {
  constructor(private readonly svc: DiscordRoutingTestService) {}

  /** Xem nhanh mock data hiện có (feature + channel) */
  @Get('mock-data')
  getMockData() {
    return { features: MOCK_FEATURES, channels: MOCK_CHANNELS };
  }

  // ---------------------------------------------------------
  // API 1 — resolve: trả về channel ID cần gửi message
  // POST /api/discord-routing/test/resolve
  //   body: { featureKey, payload, channelOverrides? }
  // ---------------------------------------------------------
  @Post('resolve')
  resolve(@Body() dto: ResolveChannelsDto) {
    try {
      return this.svc.resolveChannels(
        dto.featureKey,
        dto.payload ?? {},
        dto.channelOverrides,
      );
    } catch (error: any) {
      throw new HttpException(
        `resolve thất bại: ${error?.message ?? error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------
  // API 2 (HÀM CON) — check 1 channel có khớp payload không -> true/false
  // POST /api/discord-routing/test/check-match
  //   body: { payload, matchRule?, channelId? }
  //   -> { matched, rule, failedOn, channelId? }
  //   matched=true  => trả kèm channelId (nếu body có truyền)  => được phép gửi
  //   matched=false => channelId = null                         => bỏ qua channel
  // ---------------------------------------------------------
  @Post('check-match')
  checkMatch(@Body() dto: CheckMatchDto) {
    try {
      const r = this.svc.checkMatch(dto.matchRule, dto.payload ?? {});
      return {
        matched: r.matched,
        rule: r.rule,
        failedOn: r.failedOn,
        // chỉ trả channelId khi matched=true (đúng ý: true -> cho phép trả channel id)
        channelId: r.matched ? (dto.channelId ?? null) : null,
      };
    } catch (error: any) {
      throw new HttpException(
        `check-match thất bại: ${error?.message ?? error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ---------------------------------------------------------
  // API 3 — build chuỗi JSON match_rule từ object các property
  // POST /api/discord-routing/test/build-match-rule
  //   body: { props: { branch_id: 1, department_id: [2,5], customer_type_id: 3 } }
  //   -> { rule, matchRuleJson, humanReadable }
  //   matchRuleJson đem đi so sánh ở /check-match
  // ---------------------------------------------------------
  @Post('build-match-rule')
  buildMatchRule(@Body() dto: BuildMatchRuleDto) {
    try {
      return this.svc.buildMatchRuleJson(dto.props ?? {});
    } catch (error: any) {
      throw new HttpException(
        `build match_rule thất bại: ${error?.message ?? error}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
