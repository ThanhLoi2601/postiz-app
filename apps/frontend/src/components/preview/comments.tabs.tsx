'use client';

import { FC, useState, useEffect } from 'react';
import { CommentsComponents } from '@gitroom/frontend/components/preview/comments.components';
import { FacebookCommentsTab } from '@gitroom/frontend/components/preview/facebook.comments';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const InternalIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const FacebookIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.381H7.078v-3.471h3.047V9.827c0-3.099 1.893-4.777 4.659-4.777 1.325 0 2.463.099 2.463.099v2.701h-1.389c-1.384 0-1.814.871-1.814 1.763v2.201h3.234l-.532 3.471h-2.702V24c5.738-.9 10.125-5.864 10.125-11.854z" />
  </svg>
);

export const CommentsTabs: FC<{
  postId: string;
}> = ({ postId }) => {
  const [activeTab, setActiveTab] = useState<'internal' | 'facebook'>('internal');
  const [fbToken, setFbToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const fetch = useFetch();
  const t = useT();

  useEffect(() => {
    if (activeTab === 'facebook' && !fbToken) {
      setLoadingToken(true);
      fetch(`/public/posts/${postId}/integration-token?provider=facebook`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.token) {
            setFbToken(data.token);
          }
        })
        .finally(() => setLoadingToken(false));
    }
  }, [activeTab, fbToken, postId, fetch]);

  return (
    <div>
      <div className="flex border-b border-tableBorder mb-4">
        <button
          onClick={() => setActiveTab('internal')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'internal'
              ? 'text-white border-white'
              : 'text-gray-500 border-transparent hover:text-white'
          }`}
        >
          <InternalIcon />
          {t('internal_comments', 'Internal')}
        </button>
        <button
          onClick={() => setActiveTab('facebook')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === 'facebook'
              ? 'text-white border-white'
              : 'text-gray-500 border-transparent hover:text-white'
          }`}
        >
          <FacebookIcon />
          Facebook
        </button>
      </div>
      <div className="mt-4">
        {activeTab === 'internal' ? (
          <CommentsComponents postId={postId} />
        ) : (
          <FacebookCommentsTab postId={postId} accessToken={fbToken || undefined} />
        )}
      </div>
    </div>
  );
};