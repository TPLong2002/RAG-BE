import { Controller, Post, Body, Res, HttpStatus, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatRequestDto } from './dto/chat.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { UserId } from '../../common/decorators/user-id.decorator';

@Controller('api/chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Post()
  async chat(
    @Body() dto: ChatRequestDto,
    @UserId() userId: string,
    @Res() res: Response,
  ) {
    res.writeHead(HttpStatus.OK, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    try {
      const sources = await this.chatService.chatStream(
        {
          question: dto.question,
          provider: dto.provider,
          model: dto.model,
          documentIds: dto.documentIds,
          userId,
        },
        (chunk) => {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
        },
      );

      res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      console.error('Chat error:', err);
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: (err as Error).message });
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', error: (err as Error).message })}\n\n`);
        res.end();
      }
    }
  }
}
