import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { Request, Response } from 'express';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { AgentGraphInsertService } from '@gitroom/nestjs-libraries/agent/agent.graph.insert.service';
import { Nowpayments } from '@gitroom/nestjs-libraries/crypto/nowpayments';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';
import { OnlyURL } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

const pump = promisify(pipeline);

@ApiTags('Public')
@Controller('/public')
export class PublicController {
  constructor(
    private _trackService: TrackService,
    private _agentGraphInsertService: AgentGraphInsertService,
    private _postsService: PostsService,
    private _nowpayments: Nowpayments,
    private _subscriptionService: SubscriptionService,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}
  @Post('/agent')
  async createAgent(@Body() body: { text: string; apiKey: string }) {
    if (
      !body.apiKey ||
      !process.env.AGENT_API_KEY ||
      body.apiKey !== process.env.AGENT_API_KEY
    ) {
      return;
    }
    return this._agentGraphInsertService.newPost(body.text);
  }

  @Get(`/posts/:id`)
  async getPreview(@Param('id') id: string) {
    const posts = await this._postsService.getPostsRecursively(id, true);
    return posts.map(
      ({ childrenPost, ...p }) => ({
        ...p,
        ...(p.integration
          ? {
              integration: {
                id: p.integration.id,
                name: p.integration.name,
                picture: p.integration.picture,
                providerIdentifier: p.integration.providerIdentifier,
                profile: p.integration.profile,
              },
            }
          : {}),
      })
    );
  }

  @Get(`/posts/:id/comments`)
  async getComments(@Param('id') postId: string) {
    return { comments: await this._postsService.getComments(postId) };
  }

  @Get(`/posts/:id/facebook-comments`)
  async getFacebookComments(
    @Param('id') id: string,
    @Query('accessToken') accessToken: string
  ) {
    try {
      const posts = await this._postsService.getPostsRecursively(id, true);
      if (!posts || posts.length === 0) {
        return { success: false, comments: [], error: 'Post not found' };
      }

      const post = posts[0];
      if (!post.releaseURL || !post.releaseURL.includes('facebook.com')) {
        return { success: false, comments: [], error: 'Not a Facebook post' };
      }

      const releaseUrl = post.releaseURL;
      console.log('[PublicController] Facebook post URL:', releaseUrl);

      // Extract Facebook Page ID and Post ID - handle multiple URL formats
      let pageId: string | null = null;
      let postId: string | null = null;
      
      // Pattern 1: /PAGE_ID/posts/POST_ID (numeric page ID)
      const match1 = releaseUrl.match(/facebook\.com\/(\d+)\/posts\/(\d+)/);
      if (match1) {
        pageId = match1[1];
        postId = match1[2];
      }
      
      // Pattern 2: /username/posts/POST_ID (username format)
      if (!pageId || !postId) {
        const match2 = releaseUrl.match(/facebook\.com\/([^/]+)\/posts\/(\d+)/);
        if (match2) {
          // Only use if second part is numeric (post ID)
          if (/^\d+$/.test(match2[2])) {
            pageId = match2[1]; // This might be username, not page ID
            postId = match2[2];
          }
        }
      }
      
      // Pattern 3: /groups/GROUP_ID/posts/POST_ID
      if (!pageId || !postId) {
        const match3 = releaseUrl.match(/facebook\.com\/groups\/[^/]+\/posts\/(\d+)/);
        if (match3) postId = match3[1];
      }
      
      // Pattern 4: ?story_fbid=POST_ID
      if (!postId) {
        const match4 = releaseUrl.match(/story_fbid=(\d+)/);
        if (match4) postId = match4[1];
      }
      
      // Pattern 5: ?fbid=POST_ID (photo, video, etc)
      if (!postId) {
        const match5 = releaseUrl.match(/[?&]fbid=(\d+)/);
        if (match5) postId = match5[1];
      }

      console.log('[PublicController] Extracted - Page ID:', pageId, 'Post ID:', postId);

      if (!postId) {
        return { success: false, comments: [], error: 'Could not extract Facebook post ID' };
      }

      // For Facebook Page posts, we need to use PAGE_ID_POST_ID format
      // But we need to check if pageId is available and valid
      const fbProvider = this._integrationManager.getSocialIntegration('facebook');
      const comments = await fbProvider.getComments(postId, accessToken, pageId || undefined);

      return { success: true, comments };
    } catch (err) {
      console.error('[PublicController] Error fetching Facebook comments:', err);
      return { success: false, comments: [], error: String(err) };
    }
  }

  @Post(`/posts/:id/facebook-reply`)
  async replyFacebookComment(
    @Param('id') id: string,
    @Body() body: { message: string; replyToCommentId?: string }
  ) {
    try {
      const accessTokenRes = await this.getIntegrationToken(id, 'facebook');
      if (!accessTokenRes || !(accessTokenRes as any).success || !(accessTokenRes as any).token) {
        return { success: false, error: 'No Facebook access token' };
      }
      const accessToken = (accessTokenRes as any).token;

      const posts = await this._postsService.getPostsRecursively(id, true);
      if (!posts || posts.length === 0) {
        return { success: false, error: 'Post not found' };
      }

      const post = posts[0];
      if (!post.releaseURL || !post.releaseURL.includes('facebook.com')) {
        return { success: false, error: 'Not a Facebook post' };
      }

      const releaseUrl = post.releaseURL;
      let pageId: string | null = null;
      let postId: string | null = null;

      const match1 = releaseUrl.match(/facebook\.com\/(\d+)\/posts\/(\d+)/);
      if (match1) {
        pageId = match1[1];
        postId = match1[2];
      }

      if (!postId) {
        return { success: false, error: 'Could not extract Facebook post ID' };
      }

      const fbProvider = this._integrationManager.getSocialIntegration('facebook');
      
      const result = await fbProvider.comment(
        id,
        postId,
        body.replyToCommentId || undefined,
        accessToken,
        [{ id: postId, message: body.message, settings: {} }],
        post.integration as any
      );

      if (result && result.length > 0 && result[0].status === 'success') {
        return { success: true, commentId: result[0].postId, releaseURL: result[0].releaseURL };
      }

      return { success: false, error: 'Failed to reply comment' };
    } catch (err) {
      console.error('[PublicController] Error replying Facebook comment:', err);
      return { success: false, error: String(err) };
    }
  }

  @Get(`/posts/:id/facebook-replies`)
  async getFacebookReplies(
    @Param('id') id: string,
    @Query('commentId') commentId: string,
    @Query('accessToken') accessToken: string
  ) {
    try {
      if (!commentId) {
        return { success: false, replies: [], error: 'Comment ID required' };
      }

      const fbProvider = this._integrationManager.getSocialIntegration('facebook');
      const replies = await fbProvider.getReplies(commentId, accessToken);

      return { success: true, replies };
    } catch (err) {
      console.error('[PublicController] Error fetching Facebook replies:', err);
      return { success: false, replies: [], error: String(err) };
    }
  }

  @Get('/posts/:id/integration-token')
  async getIntegrationToken(
    @Param('id') id: string,
    @Query('provider') provider: string
  ) {
    try {
      const posts = await this._postsService.getPostsRecursively(id, true);
      if (!posts || posts.length === 0) {
        return { success: false, token: null };
      }

      const post = posts[0];
      if (!post.integrationId || !post.organizationId) {
        return { success: false, token: null };
      }

      const integration = await this._integrationService.getIntegrationById(
        post.organizationId,
        post.integrationId
      );

      if (!integration || integration.providerIdentifier !== provider) {
        return { success: false, token: null };
      }

      return { success: true, token: integration.token };
    } catch (err) {
      console.error('[PublicController] Error getting integration token:', err);
      return { success: false, token: null };
    }
  }

  @Post('/t')
  async trackEvent(
    @Res() res: Response,
    @Req() req: Request,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { fbclid?: string; tt: TrackEnum; additional: Record<string, any> }
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid
    );
    if (!req.cookies.track) {
      res.cookie('track', uniqueId, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    if (body.fbclid && !req.cookies.fbclid) {
      res.cookie('fbclid', body.fbclid, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
            }
          : {}),
        sameSite: 'none',
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    res.status(200).json({
      track: uniqueId,
    });
  }

  @Post('/modify-subscription')
  async modifySubscription(@Body('params') params: string) {
    try {
      const load = AuthService.verifyJWT(params) as {
        orgId: string;
        billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
      };

      if (!load || !load.orgId || !load.billing || !pricing[load.billing]) {
        return { success: false };
      }

      const totalChannels = pricing[load.billing].channel || 0;

      await this._subscriptionService.modifySubscriptionByOrg(
        load.orgId,
        totalChannels,
        load.billing
      );

      return { success: true };
    } catch (err) {
      return { success: false };
    }
  }

  @Post('/crypto/:path')
  async cryptoPost(@Body() body: any, @Param('path') path: string) {
    console.log('cryptoPost', body, path);
    return this._nowpayments.processPayment(path, body);
  }

  @Get('/stream')
  async streamFile(
    @Query() query: OnlyURL,
    @Res() res: Response,
    @Req() req: Request
  ) {
    const { url } = query;
    if (!url.endsWith('mp4')) {
      return res.status(400).send('Invalid video URL');
    }

    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('aborted', onClose);
    res.on('close', onClose);

    // Manually follow redirects so every hop is re-validated against
    // the SSRF blocklist (see GHSA-34w8-5j2v-h6ww). `fetch` defaults to
    // `redirect: 'follow'`, which bypasses the DTO-level URL check.
    const MAX_REDIRECTS = 5;
    let currentUrl = url;
    let r: globalThis.Response | undefined;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await isSafePublicHttpsUrl(currentUrl))) {
        return res.status(400).send('Blocked URL');
      }

      r = await fetch(currentUrl, {
        signal: ac.signal,
        redirect: 'manual',
      });

      if (r.status >= 300 && r.status < 400) {
        const location = r.headers.get('location');
        if (!location) {
          return res.status(502).send('Redirect without Location');
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return res.status(400).send('Invalid redirect target');
        }
        continue;
      }

      break;
    }

    if (!r) {
      return res.status(502).send('No upstream response');
    }

    if (r.status >= 300 && r.status < 400) {
      return res.status(508).send('Too many redirects');
    }

    if (!r.ok && r.status !== 206) {
      res.status(r.status);
      throw new Error(`Upstream error: ${r.statusText}`);
    }

    const type = r.headers.get('content-type') ?? 'application/octet-stream';
    res.setHeader('Content-Type', type);

    const contentRange = r.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);

    const len = r.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const acceptRanges = r.headers.get('accept-ranges') ?? 'bytes';
    res.setHeader('Accept-Ranges', acceptRanges);

    if (r.status === 206) res.status(206); // Partial Content for range responses

    try {
      await pump(Readable.fromWeb(r.body as any), res);
    } catch (err) {}
  }
}
