'use client';

import { FC, useState, useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

type SentimentFilter = 'all' | 'positive' | 'negative' | 'neutral';

export const CommentsAnalytics: FC<{
  postId: string;
}> = ({ postId }) => {
  const [sentimentFilter, setSentimentFilter] =
    useState<SentimentFilter>('all');
  const fetch = useFetch();
  const t = useT();

  const getAnalytics = useCallback(async () => {
    return (await fetch(`/public/posts/${postId}/comments-analytics`)).json();
  }, [postId, fetch]);

  const { data, isLoading, error } = useSWR(
    `comments-analytics-${postId}`,
    getAnalytics,
    {
      refreshInterval: 300000,
      revalidateOnFocus: false,
    },
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-third p-4 rounded-lg animate-pulse">
              <div className="h-8 bg-tableBorder rounded w-12 mb-2"></div>
              <div className="h-4 bg-tableBorder rounded w-20"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="text-gray-500 text-center py-8">
        {t('no_analytics_available', 'No analytics available')}
      </div>
    );
  }

  const {
    summary,
    sentiment,
    topUsers,
    keywords,
    positiveComments,
    negativeComments,
    neutralComments,
  } = data;

  const getFilteredComments = () => {
    switch (sentimentFilter) {
      case 'positive':
        return positiveComments || [];
      case 'negative':
        return negativeComments || [];
      case 'neutral':
        return neutralComments || [];
      default:
        return [
          ...(positiveComments || []),
          ...(negativeComments || []),
          ...(neutralComments || []),
        ];
    }
  };

  const filteredComments = getFilteredComments();
  const totalComments =
    (positiveComments?.length || 0) +
    (negativeComments?.length || 0) +
    (neutralComments?.length || 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-third p-4 rounded-lg border border-tableBorder">
          <div className="text-2xl font-bold text-white">
            {summary?.totalComments || 0}
          </div>
          <div className="text-xs text-gray-400">
            {t('comments', 'Comments')}
          </div>
        </div>
        <div className="bg-third p-4 rounded-lg border border-tableBorder">
          <div className="text-2xl font-bold text-white">
            {summary?.totalReplies || 0}
          </div>
          <div className="text-xs text-gray-400">{t('replies', 'Replies')}</div>
        </div>
      </div>

      <div className="bg-third p-4 rounded-lg border border-tableBorder">
        <div className="text-sm font-medium text-gray-400 mb-3">
          {t('sentiment_distribution', 'Sentiment Distribution')}
        </div>
        <div className="h-3 bg-tableBorder rounded-full overflow-hidden flex">
          <div
            className="bg-green-500 h-full"
            style={{ width: `${sentiment?.positive || 0}%` }}
          ></div>
          <div
            className="bg-gray-500 h-full"
            style={{ width: `${sentiment?.neutral || 0}%` }}
          ></div>
          <div
            className="bg-red-500 h-full"
            style={{ width: `${sentiment?.negative || 0}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-2">
          <span>
            {t('positive', 'Positive')}: {sentiment?.positive || 0}%
          </span>
          <span>
            {t('neutral', 'Neutral')}: {sentiment?.neutral || 0}%
          </span>
          <span>
            {t('negative', 'Negative')}: {sentiment?.negative || 0}%
          </span>
        </div>
      </div>

      <div className="bg-third p-4 rounded-lg border border-tableBorder">
        <div className="text-sm font-medium text-gray-400 mb-3">
          {t('top_contributors', 'Top Contributors')}
        </div>
        <div className="space-y-2">
          {(topUsers || []).slice(0, 5).map((item: any, idx: number) => (
            <div
              key={idx}
              className="flex justify-between items-center text-sm"
            >
              <span className="text-gray-300">
                {idx + 1}. {item.user}
              </span>
              <span className="text-gray-500">{item.count} comments</span>
            </div>
          ))}
        </div>
      </div>

      {keywords && keywords.length > 0 && (
        <div className="bg-third p-4 rounded-lg border border-tableBorder">
          <div className="text-sm font-medium text-gray-400 mb-3">
            {t('keywords', 'Keywords')}
          </div>
          <div className="flex flex-wrap gap-2">
            {keywords.slice(0, 15).map((kw: { word: string; count: number }, idx: number) => (
              <span
                key={idx}
                className="flex items-center gap-1 px-3 py-1 bg-tableBorder rounded-full text-sm text-gray-300"
              >
                {kw.word}
                {kw.count > 1 && (
                  <span className="text-[10px] font-semibold bg-gray-600 text-gray-200 rounded-full px-1.5 py-0.5 leading-none">
                    {kw.count}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-tableBorder pt-4">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setSentimentFilter('positive')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              sentimentFilter === 'positive'
                ? 'bg-green-600 text-white'
                : 'bg-tableBorder text-gray-400 hover:text-white'
            }`}
          >
            {t('positive', 'Positive')} ({positiveComments?.length || 0})
          </button>
          <button
            onClick={() => setSentimentFilter('negative')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              sentimentFilter === 'negative'
                ? 'bg-red-600 text-white'
                : 'bg-tableBorder text-gray-400 hover:text-white'
            }`}
          >
            {t('negative', 'Negative')} ({negativeComments?.length || 0})
          </button>
          <button
            onClick={() => setSentimentFilter('all')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              sentimentFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-tableBorder text-gray-400 hover:text-white'
            }`}
          >
            {t('all', 'All')} ({totalComments})
          </button>
        </div>

        <div className="space-y-3 max-h-[400px] overflow-y-auto">
          {filteredComments.length === 0 ? (
            <div className="text-gray-500 text-center py-4">
              {t('no_comments', 'No comments')}
            </div>
          ) : (
            filteredComments.map((comment: any, idx: number) => (
              <div
                key={idx}
                className={`p-3 bg-third rounded-lg border border-tableBorder ${comment.permalinkUrl ? 'cursor-pointer hover:border-gray-500 transition-colors' : ''}`}
                onClick={() => {
                  if (comment.permalinkUrl) {
                    window.open(comment.permalinkUrl, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  {comment.authorPicture && (
                    <img
                      src={comment.authorPicture}
                      alt={comment.authorName}
                      className="w-8 h-8 rounded-full"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-white">
                        {comment.authorName}
                      </span>
                      <span className="text-xs text-gray-500">
                        {dayjs(comment.createdAt).fromNow()}
                      </span>
                      {comment.permalinkUrl && (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width={12}
                          height={12}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-gray-500"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      )}
                    </div>
                    <p className="text-sm text-gray-300">{comment.content}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width={14}
                          height={14}
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};