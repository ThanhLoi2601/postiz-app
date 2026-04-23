import { Injectable, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class SyncCommentsService implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit() {
    try {
      await this.startSyncCommentsWorkflow();
    } catch (error) {
      console.error('[SyncCommentsService] Error starting workflow:', error);
    }
  }

  async startSyncCommentsWorkflow() {
    try {
      await this._temporalService.client
        .getRawClient()
        ?.workflow.start('syncCommentsWorkflow', {
          workflowId: 'sync-comments-global',
          taskQueue: 'main',
          workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        });
      console.log('[SyncCommentsService] Sync comments workflow started');
    } catch (error) {
      console.error(
        '[SyncCommentsService] Error starting sync comments workflow:',
        error,
      );
    }
  }
}
