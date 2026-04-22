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
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { socialIntegrationList } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import OpenAI from 'openai';
import { z } from 'zod';
import { CommentSentimentService } from '@gitroom/backend/services/comment-sentiment.service';

const pump = promisify(pipeline);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface SocialCommentData {
  sourceCommentId?: string;
  parentCommentId?: string | null;
  content: string;
  authorId?: string;
  authorName?: string;
  authorPicture?: string | null;
  likeCount?: number;
  createdAt?: string;
}

const SentimentResult = z.object({
  commentId: z.string(),
  author: z.string(),
  content: z.string(),
  sentiment: z.enum(['POSITIVE', 'NEGATIVE', 'NEUTRAL']),
  keywords: z.array(z.string()),
  likes: z.number(),
});

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
    private _integrationManager: IntegrationManager,
    private _prismaService: PrismaService,
    private _commentSentimentService: CommentSentimentService,

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
    return posts.map(({ childrenPost, ...p }) => ({
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
    }));
  }

  @Get(`/posts/:id/comments`)
  async getComments(@Param('id') postId: string) {
    return { comments: await this._postsService.getComments(postId) };
  }

  @Get(`/posts/:id/facebook-comments`)
  async getFacebookComments(
    @Param('id') id: string,
    @Query('accessToken') accessToken: string,
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
        const match3 = releaseUrl.match(
          /facebook\.com\/groups\/[^/]+\/posts\/(\d+)/,
        );
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

      console.log(
        '[PublicController] Extracted - Page ID:',
        pageId,
        'Post ID:',
        postId,
      );

      if (!postId) {
        return {
          success: false,
          comments: [],
          error: 'Could not extract Facebook post ID',
        };
      }

      // For Facebook Page posts, we need to use PAGE_ID_POST_ID format
      // But we need to check if pageId is available and valid
      const fbProvider =
        this._integrationManager.getSocialIntegration('facebook');
      const comments = await fbProvider.getComments(
        postId,
        accessToken,
        pageId || undefined,
      );

      return { success: true, comments };
    } catch (err) {
      console.error(
        '[PublicController] Error fetching Facebook comments:',
        err,
      );
      return { success: false, comments: [], error: String(err) };
    }
  }

  async sendToTelegram(messages: string[]) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    for (const text of messages) {
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
      } catch (err) {
        console.error('[Telegram] Send error:', err);
      }
    }
  }

  private buildNegativeMessages(
    sentimentResults: any[],
    allCommentsWithReplies: any[],
  ): string[] {
    const messages: string[] = [];

    for (const r of sentimentResults) {
      if (r.sentiment !== 'NEGATIVE') continue;

      const original = allCommentsWithReplies.find(
        (c) => c.sourceCommentId === r.commentId,
      );

      if (!original) continue;

      const content = original.content?.slice(0, 200) || '';
      const author = original.authorName || 'Unknown';
      const link = original.permalinkUrl || 'No link';

      const msg = `
  <b>⚠️ Negative Comment</b>
  👤 <b>${author}</b>
  💬 ${content}
  🔗 <a href="${link}">View comment</a>
  `;

      messages.push(msg);
    }

    return messages;
  }
  
  @Get(`/posts/:id/comments-analytics`)
  async getCommentsAnalytics(@Param('id') id: string) {
    try {
      const posts = await this._postsService.getPostsRecursively(id, true);
      if (!posts || posts.length === 0) {
        return { success: false, error: 'Post not found' };
      }

      const post = posts[0];
      if (!post.integration) {
        return { success: false, error: 'No integration found' };
      }

      const provider = socialIntegrationList.find(
        (p) => p.identifier === post.integration.providerIdentifier,
      );

      if (!provider || !provider.getComments) {
        return { success: false, error: 'Provider does not support comments' };
      }

      const accessTokenRes = await this.getIntegrationToken(
        id,
        post.integration.providerIdentifier,
      );
      if (!(accessTokenRes as any).success || !(accessTokenRes as any).token) {
        return { success: false, error: 'No access token' };
      }
      const accessToken = (accessTokenRes as any).token;

      let fbPostId = post.releaseId;
      if (!fbPostId && post.releaseURL) {
        const match = post.releaseURL.match(/facebook\.com\/\d+\/posts\/(\d+)/);
        if (match) fbPostId = match[1];
      }

      if (!fbPostId) {
        return { success: false, error: 'Could not extract post ID' };
      }

      // ===== STEP 1: Fetch main comments =====
      const mainComments = (await provider.getComments(
        fbPostId,
        accessToken,
      )) as any[];

      if (!mainComments || mainComments.length === 0) {
        return {
          success: true,
          summary: { totalComments: 0, totalReplies: 0 },
          sentiment: { positive: 0, negative: 0, neutral: 0 },
          topUsers: [],
          keywords: [],
          positiveComments: [],
          negativeComments: [],
          neutralComments: [],
        };
      }

      // ===== STEP 2: Fetch replies for each comment =====
      console.log('[Analytics] Fetching replies for', mainComments.length, 'comments');
      
      const allCommentsWithReplies: any[] = [];
      let totalRepliesCount = 0;

      for (const comment of mainComments) {
        // Add main comment first
        const mainCommentData = {
          sourceCommentId: comment.id,
          content: comment.content || comment.message || '',
          authorName: comment.author?.name || comment.from?.name || 'Unknown',
          authorId: comment.author?.id || comment.from?.id || '',
          authorPicture: comment.author?.picture || comment.from?.picture?.data?.url || null,
          likeCount: comment.likeCount || comment.like_count || 0,
          createdAt: comment.createdAt || comment.created_time,
          permalinkUrl: comment.permalinkUrl || null,
          isReply: false, // Mark as main comment
        };
        allCommentsWithReplies.push(mainCommentData);

        // Fetch replies if available
        if (provider.getReplies) {

          const fetchRepliesRecursively = async (parentId: string, depth: number = 0) => {
            if (depth > 10) return; // Safety cap to avoid infinite loops
            try {
              const replies = await provider.getReplies!(parentId, accessToken);
              if (!replies || replies.length === 0) return;
 
              totalRepliesCount += replies.length;
 
              for (const reply of replies) {
                allCommentsWithReplies.push({
                  sourceCommentId: reply.id,
                  parentCommentId: parentId,
                  content: reply.content || '',
                  authorName: reply.author?.name || 'Unknown',
                  authorId: reply.author?.id || '',
                  authorPicture: reply.author?.picture || null,
                  likeCount: 0,
                  createdAt: reply.createdAt,
                  permalinkUrl: reply.permalinkUrl || null,
                  isReply: true,
                });
 
                // Recurse into this reply's replies
                await fetchRepliesRecursively(reply.id, depth + 1);
              }
            } catch (err) {
              console.error('[Analytics] Error fetching replies for', parentId, err);
            }
          };
 
          await fetchRepliesRecursively(comment.id);
        }
      }

      console.log('[Analytics] Total comments + replies:', allCommentsWithReplies.length);
      console.log('[Analytics] Main comments:', mainComments.length, 'Replies:', totalRepliesCount);

      // ===== STEP 4: Prepare data for AI sentiment analysis =====
      // Include BOTH comments and replies (up to 100 total for analysis)
      const commentsForAnalysis = allCommentsWithReplies
        .slice(0, 100)
        .map((c: any, idx: number) => ({
          commentId: c.sourceCommentId || `comment_${idx}`,
          author: c.authorName || 'Unknown',
          content: c.content || '',
          likes: c.likeCount || 0,
          isReply: c.isReply || false,
        }));

      // ===== CACHING START =====
      const { cached, toAnalyze } =
        await this._commentSentimentService.prepareForAnalysis(
          fbPostId,
          commentsForAnalysis,
        );

      console.log(
        `[Analytics] Cache hit: ${cached.length}, To analyze: ${toAnalyze.length}`,
      );

      let newSentimentResults: any[] = [];

      if (toAnalyze.length > 0) {
        const analysisPrompt = `You are a sentiment analysis expert for social media comments.
Understand both English and Vietnamese.
Classify each comment by overall meaning, tone, and intent:
- POSITIVE: praise, satisfaction, support
- NEGATIVE: complaint, anger, criticism
- NEUTRAL: no clear sentiment
Handle slang & mixed Vietnamese-English.
Extract up to 3 keywords.
Return JSON only:
${JSON.stringify(
  toAnalyze.map((c: any) => ({
    commentId: c.commentId,
    author: c.author,
    content: c.content.substring(0, 200),
    likes: c.likes,
    isReply: c.isReply,
  })),
)}`;

        try {
          const analysisResult = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'system', content: analysisPrompt }],
            temperature: 0,
            max_tokens: 6000,
          });

          const content = analysisResult.choices[0]?.message?.content || '[]';
          const parsed = content
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();

          newSentimentResults = JSON.parse(parsed);

          // Save cache
          await this._commentSentimentService.saveSentiments(
            fbPostId,
            newSentimentResults,
          );

          console.log(
            `[Analytics] Saved ${newSentimentResults.length} new sentiments`,
          );
        } catch (err) {
          console.error('[Analytics] OpenAI error:', err);
        }
      }
      this.buildNegativeMessages(newSentimentResults,allCommentsWithReplies)
      // Merge cached + new
      const sentimentResults = [...cached, ...newSentimentResults];
      // ===== STEP 5: Build sentiment map =====
      const sentimentMap = new Map();
      for (const r of sentimentResults) {
        sentimentMap.set(r.commentId, r);
      }

      // ===== STEP 6: Count sentiments and categorize (include BOTH comments + replies) =====
      let positive = 0,
        negative = 0,
        neutral = 0;
      const positiveList: any[] = [],
        negativeList: any[] = [],
        neutralList: any[] = [];
      const userComments: Record<string, number> = {};
      const allKeywords: string[] = [];

      for (const comment of allCommentsWithReplies) {
        const result = sentimentMap.get(comment.sourceCommentId) || {
          sentiment: 'NEUTRAL',
          keywords: [],
        };
        const sentiment = result.sentiment || 'NEUTRAL';

        if (sentiment === 'POSITIVE') {
          positive++;
          if (positiveList.length < 20) positiveList.push(comment);
        } else if (sentiment === 'NEGATIVE') {
          negative++;
          if (negativeList.length < 20) negativeList.push(comment);
        } else {
          neutral++;
          if (neutralList.length < 20) neutralList.push(comment);
        }

        // Count by user (for Top Contributors)
        const authorName = comment.authorName || 'Unknown';
        userComments[authorName] = (userComments[authorName] || 0) + 1;

        // Collect keywords (normalize to lowercase for dedup)
        if (result.keywords) {
          for (const kw of result.keywords) {
            const normalized = kw.trim().toLowerCase();
            if (normalized) allKeywords.push(normalized);
          }
        }
      }

      // ===== STEP 7: Build Top Contributors list =====
      const topUsers = Object.entries(userComments)
        .sort((a: any, b: any) => b[1] - a[1])
        .slice(0, 10)
        .map(([user, count]) => ({ user, count }));

      // ===== STEP 8: Calculate percentages based on total (comments + replies) =====
      const total = allCommentsWithReplies.length || 1;
      
      // Dedup keywords: count occurrences, sort by count desc, take top 20
      const keywordCountMap: Record<string, number> = {};
      for (const kw of allKeywords) {
        keywordCountMap[kw] = (keywordCountMap[kw] || 0) + 1;
      }
      const keywords = Object.entries(keywordCountMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, count]) => ({ word, count }));

      return {
        success: true,
        summary: {
          totalComments: mainComments.length,  // Only main comments
          totalReplies: totalRepliesCount,     // Actual reply count
        },
        sentiment: {
          positive: Math.round((positive / total) * 100),
          negative: Math.round((negative / total) * 100),
          neutral: Math.round((neutral / total) * 100),
        },
        topUsers,
        keywords,
        positiveComments: positiveList.slice(0, 20),
        negativeComments: negativeList.slice(0, 20),
        neutralComments: neutralList.slice(0, 20),
      };
    } catch (err) {
      console.error('[PublicController] Error analytics:', err);
      return { success: false, error: String(err) };
    }
  }
  @Post(`/posts/:id/facebook-reply`)
  async replyFacebookComment(
    @Param('id') id: string,
    @Body() body: { message: string; replyToCommentId?: string },
  ) {
    try {
      const accessTokenRes = await this.getIntegrationToken(id, 'facebook');
      if (
        !accessTokenRes ||
        !(accessTokenRes as any).success ||
        !(accessTokenRes as any).token
      ) {
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

      const fbProvider =
        this._integrationManager.getSocialIntegration('facebook');

      const result = await fbProvider.comment(
        id,
        postId,
        body.replyToCommentId || undefined,
        accessToken,
        [{ id: postId, message: body.message, settings: {} }],
        post.integration as any,
      );

      if (result && result.length > 0 && result[0].status === 'success') {
        return {
          success: true,
          commentId: result[0].postId,
          releaseURL: result[0].releaseURL,
        };
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
    @Query('accessToken') accessToken: string,
  ) {
    try {
      if (!commentId) {
        return { success: false, replies: [], error: 'Comment ID required' };
      }

      const fbProvider =
        this._integrationManager.getSocialIntegration('facebook');
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
    @Query('provider') provider: string,
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
        post.integrationId,
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
    body: { fbclid?: string; tt: TrackEnum; additional: Record<string, any> },
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid,
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
        load.billing,
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
    @Req() req: Request,
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