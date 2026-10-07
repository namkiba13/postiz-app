import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { Injectable } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';

@Injectable()
export class MastraService {
  static mastra: Mastra;
  constructor(private _loadToolsService: LoadToolsService) {}

  async removeStoredToolResults(
    threadId: string,
    resourceId: string,
    messages: { role: string; toolCallId?: string }[]
  ) {
    if (!messages.some((message) => message?.role === 'tool')) return messages;
    const mastra = await this.mastra();
    const memory = await mastra.getAgent('postiz').getMemory();
    const { messages: stored } = await memory.recall({
      threadId,
      resourceId,
      perPage: false,
    });
    const completed = new Set(
      stored.flatMap((message) =>
        message.content.parts.flatMap((part) =>
          part.type === 'tool-invocation' && part.toolInvocation.state === 'result'
            ? [part.toolInvocation.toolCallId]
            : []
        )
      )
    );
    // AG-UI gives replayed tool results fresh IDs. Its Mastra bridge otherwise
    // re-saves their old tool-call-only message over the complete assistant turn.
    return messages.filter(
      (message) =>
        message?.role !== 'tool' || !completed.has(message.toolCallId)
    );
  }

  async mastra() {
    MastraService.mastra =
      MastraService.mastra ||
      new Mastra({
        storage: pStore,
        agents: {
          postiz: await this._loadToolsService.agent(),
        },
        logger: new ConsoleLogger({
          level: 'info',
        }),
      });

    return MastraService.mastra;
  }
}
