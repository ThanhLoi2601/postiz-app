import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { Integration, Post } from '@prisma/client';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
@Activity()
export class IntegrationsActivity {
  constructor(
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _prismaService: PrismaService,
  ) {}

  @ActivityMethod()
  async getIntegrationsById(id: string, orgId: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  async refreshToken(integration: Integration) {
    return this._refreshIntegrationService.refresh(integration);
  }

  @ActivityMethod()
  async getPublishedPostsWithFacebook() {
    const posts = await this._prismaService.post.findMany({
      where: {
        state: 'PUBLISHED',
        releaseId: { not: null },
      },
      include: {
        integration: true,
      },
    });

    return posts.filter(
      (post) =>
        post.integration?.providerIdentifier === 'facebook' &&
        post.integration?.token,
    );
  }

  @ActivityMethod()
  async syncPostComments(postId: string) {
    try {
      const backendUrl =
        process.env.BACKEND_INTERNAL_URL || 'http://localhost:3000';
      const response = await fetch(
        `${backendUrl}/public/posts/${postId}/comments-analytics`,
      );
      const data = await response.json();
      return { success: true, postId, data };
    } catch (error) {
      console.error(`[SyncComments] Error for post ${postId}:`, error);
      return { success: false, postId, error: String(error) };
    }
  }
}
