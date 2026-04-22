// ==========================================
// COMMENT SENTIMENT CACHE SERVICE
// ==========================================

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { createHash } from 'crypto';

interface SentimentResult {
  commentId: string;
  author: string;
  content: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  keywords: string[];
  confidence?: number;
}

@Injectable()
export class CommentSentimentService {
  constructor(private _prismaService: PrismaService) {}

  /**
   * Generate hash từ content để detect identical comments
   */
  private generateContentHash(content?: string): string {
    return createHash('md5')
      .update((content || '').toLowerCase().trim())
      .digest('hex');
  }

  /**
   * Bulk get cached sentiments for multiple comments
   * Returns: Map<commentId, sentiment>
   */
  async getCachedSentiments(
    comments: Array<{ commentId: string; content: string }>,
  ): Promise<Map<string, SentimentResult>> {
    const commentIds = comments.map((c) => c.commentId);

    // Fetch từ database
    const cached = await this._prismaService.commentSentiment.findMany({
      where: {
        commentId: { in: commentIds },
      },
    });

    const resultMap = new Map<string, SentimentResult>();

    for (const item of cached) {
      resultMap.set(item.commentId, {
        commentId: item.commentId,
        author: item.authorName || '',
        content: item.content,
        sentiment: item.sentiment as 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL',
        keywords: (item.keywords as string[]) || [],
        confidence: item.confidence || undefined,
      });
    }

    return resultMap;
  }

  /**
   * Check if content exists (dựa vào hash)
   * Useful for detecting duplicate comments
   */
  async findByContentHash(
    contentHash: string,
  ): Promise<SentimentResult | null> {
    const cached = await this._prismaService.commentSentiment.findFirst({
      where: { contentHash },
      orderBy: { analyzedAt: 'desc' },
    });

    if (!cached) return null;

    return {
      commentId: cached.commentId,
      author: cached.authorName || '',
      content: cached.content,
      sentiment: cached.sentiment as 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL',
      keywords: (cached.keywords as string[]) || [],
      confidence: cached.confidence || undefined,
    };
  }

  /**
   * Bulk save sentiment results
   */
  async saveSentiments(
    postId: string,
    results: SentimentResult[],
  ): Promise<void> {
    const records = results.map((r) => ({
      commentId: r.commentId,
      postId,
      content: r.content,
      contentHash: this.generateContentHash(r.content),
      authorId: null,
      authorName: r.author,
      sentiment: r.sentiment,
      keywords: r.keywords,
      confidence: r.confidence,
      analyzedAt: new Date(),
      lastUsedAt: new Date(),
    }));

    // Upsert để tránh duplicate
    await this._prismaService.$transaction(
      records.map((record) =>
        this._prismaService.commentSentiment.upsert({
          where: { commentId: record.commentId },
          update: {
            lastUsedAt: new Date(), // Update last used time
          },
          create: record,
        }),
      ),
    );
  }

  /**
   * Bulk analyze comments with caching
   * Returns: { cached, toAnalyze }
   */
  async prepareForAnalysis(
    postId: string,
    comments: Array<{
      commentId: string;
      author: string;
      content: string;
      likes: number;
      isReply?: boolean;
    }>,
  ): Promise<{
    cached: SentimentResult[];
    toAnalyze: Array<{
      commentId: string;
      author: string;
      content: string;
      likes: number;
      isReply?: boolean;
    }>;
  }> {
    // Get cached results
    const cachedMap = await this.getCachedSentiments(comments);

    const cached: SentimentResult[] = [];
    const toAnalyze: typeof comments = [];

    for (const comment of comments) {
      const cachedResult = cachedMap.get(comment.commentId);
      if (cachedResult) {
        cached.push(cachedResult);
      } else {
        // Check if identical content exists (by hash)
        const contentHash = this.generateContentHash(comment.content);
        const existingByHash = await this.findByContentHash(contentHash);

        if (existingByHash) {
          // Reuse sentiment from identical content
          cached.push({
            ...existingByHash,
            commentId: comment.commentId, // Use new comment ID
            author: comment.author,
          });

          // Save this mapping for future use
          await this.saveSentiments(postId, [
            {
              commentId: comment.commentId,
              author: comment.author,
              content: comment.content,
              sentiment: existingByHash.sentiment,
              keywords: existingByHash.keywords,
              confidence: existingByHash.confidence,
            },
          ]);
        } else {
          toAnalyze.push(comment);
        }
      }
    }

    return { cached, toAnalyze };
  }

  /**
   * Clean up old cache (older than 90 days)
   */
  async cleanupOldCache(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this._prismaService.commentSentiment.deleteMany({
      where: {
        lastUsedAt: { lt: cutoffDate },
      },
    });

    return result.count;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(postId?: string) {
    const where = postId ? { postId } : {};

    const [total, byPost, bySentiment] = await Promise.all([
      // Total cached
      this._prismaService.commentSentiment.count({ where }),

      // Group by post
      postId
        ? null
        : this._prismaService.commentSentiment.groupBy({
            by: ['postId'],
            _count: true,
            orderBy: { _count: { commentId: 'desc' } },
            take: 10,
          }),

      // Group by sentiment
      this._prismaService.commentSentiment.groupBy({
        by: ['sentiment'],
        _count: true,
        where,
      }),
    ]);

    return {
      total,
      byPost,
      bySentiment: bySentiment.reduce(
        (acc, item) => {
          acc[item.sentiment] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }
}