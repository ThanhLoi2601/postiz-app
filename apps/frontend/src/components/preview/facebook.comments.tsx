'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { FC, useCallback, useState, useRef } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { FieldValues, SubmitHandler, useForm } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface ReplyData {
  id: string;
  content: string;
  author: {
    id: string;
    name: string;
    picture?: string;
  };
  createdAt: string;
  permalinkUrl?: string;
}

const formatTime = (date: string) => {
  const d = dayjs(date);
  const now = dayjs();
  const diffHours = now.diff(d, 'hour');
  
  if (diffHours < 1) {
    const diffMinutes = now.diff(d, 'minute');
    if (diffMinutes < 1) return 'Just now';
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffHours < 48) return 'Yesterday';
  if (diffHours < 168) return d.format('dddd');
  return d.format('MMM D, YYYY');
};

const Avatar = ({ src, name }: { src?: string; name: string }) => {
  if (src) {
    return <img src={src} alt={name} className="w-10 h-10 rounded-full object-cover" />;
  }
  const getInitials = (n: string) => n.split(' ').map(part => part[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-sm">
      {getInitials(name)}
    </div>
  );
};

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
  </svg>
);

export const FacebookCommentsTab: FC<{
  postId: string;
  accessToken?: string;
}> = ({ postId, accessToken }) => {
  const fetch = useFetch();
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [expandedReplies, setExpandedReplies] = useState<Record<string, boolean>>({});
  const [repliesData, setRepliesData] = useState<Record<string, ReplyData[]>>({});
  const [loadingReplies, setLoadingReplies] = useState<Record<string, boolean>>({});
  const { register, handleSubmit, reset, setValue } = useForm();
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const mainTextareaRef = useRef<HTMLTextAreaElement>(null);
  const t = useT();

  const user = useUser();

  const goToComments = useCallback(() => {
    window.location.href = `/auth?returnUrl=${window.location.href}`;
  }, []);
  if (!user?.id) {
    return (
      <Button onClick={goToComments}>
        {t(
          'login_register_to_add_comments',
          'Login / Register to add comments'
        )}
      </Button>
    );
  }

  const fetcher = useCallback(async () => {
    if (!accessToken) {
      return { success: false, comments: [], error: 'No access token' };
    }
    return (await fetch(`/public/posts/${postId}/facebook-comments?accessToken=${encodeURIComponent(accessToken)}`)).json();
  }, [fetch, postId, accessToken]);

  const { data, mutate, isLoading } = useSWR(
    accessToken ? `facebook-comments-${postId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );

  const handleReply = useCallback((id: string, name: string) => {
    setReplyTo({ id, name });
    setSubmitError(null);
    setSubmitSuccess(false);
    setTimeout(() => replyTextareaRef.current?.focus(), 100);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyTo(null);
    reset();
    setSubmitError(null);
    setSubmitSuccess(false);
  }, [reset]);

  const loadReplies = useCallback(async (commentId: string) => {
    if (!accessToken) return;
    
    setLoadingReplies(prev => ({ ...prev, [commentId]: true }));
    
    try {
      const res = await fetch(`/public/posts/${postId}/facebook-replies?commentId=${commentId}&accessToken=${encodeURIComponent(accessToken)}`);
      const data = await res.json();
      
      if (data.success && data.replies) {
        setRepliesData(prev => ({ ...prev, [commentId]: data.replies }));
        setExpandedReplies(prev => ({ ...prev, [commentId]: true }));
      }
    } catch (err) {
      console.error('Error loading replies:', err);
    } finally {
      setLoadingReplies(prev => ({ ...prev, [commentId]: false }));
    }
  }, [accessToken, fetch, postId]);

  const toggleReplies = useCallback((commentId: string) => {
    if (expandedReplies[commentId]) {
      setExpandedReplies(prev => ({ ...prev, [commentId]: false }));
    } else {
      if (!repliesData[commentId]) {
        loadReplies(commentId);
      } else {
        setExpandedReplies(prev => ({ ...prev, [commentId]: true }));
      }
    }
  }, [expandedReplies, repliesData, loadReplies]);

  const onReplySubmit: SubmitHandler<FieldValues> = useCallback(async (e) => {
    if (!accessToken || !replyTo) return;
    
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    
    try {
      const res = await fetch(`/public/posts/${postId}/facebook-reply`, {
        method: 'POST',
        body: JSON.stringify({
          message: e.replyMessage,
          replyToCommentId: replyTo.id
        })
      });
      const data = await res.json();
      
      if (data.success) {
        setSubmitSuccess(true);
        setReplyTo(null);
        reset();
        mutate();
        setTimeout(() => setSubmitSuccess(false), 3000);
      } else {
        setSubmitError(data.error || 'Failed to reply');
      }
    } catch (err) {
      setSubmitError('Error posting reply');
    } finally {
      setIsSubmitting(false);
    }
  }, [accessToken, replyTo, postId, fetch, reset, mutate]);

  const onNewCommentSubmit: SubmitHandler<FieldValues> = useCallback(async (e) => {
    if (!accessToken) return;
    
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);
    
    try {
      const res = await fetch(`/public/posts/${postId}/facebook-comment`, {
        method: 'POST',
        body: JSON.stringify({ message: e.newComment })
      });
      const data = await res.json();
      
      if (data.success) {
        setSubmitSuccess(true);
        reset();
        mutate();
        setTimeout(() => setSubmitSuccess(false), 3000);
      } else {
        setSubmitError(data.error || 'Failed to post comment');
      }
    } catch (err) {
      setSubmitError('Error posting comment');
    } finally {
      setIsSubmitting(false);
    }
  }, [accessToken, postId, fetch, reset, mutate]);

  const openInFacebook = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const commentsList = data?.success ? data.comments || [] : [];

  if (!accessToken) {
    return (
      <div className="text-center py-8 text-gray-500">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.381H7.078v-3.471h3.047V9.827c0-3.099 1.893-4.777 4.659-4.777 1.325 0 2.463.099 2.463.099v2.701h-1.389c-1.384 0-1.814.871-1.814 1.763v2.201h3.234l-.532 3.471h-2.702V24c5.738-.9 10.125-5.864 10.125-11.854z" />
        </svg>
        <p className="text-sm">{t('facebook_token_required', 'Facebook access token required')}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data?.success) {
    return <div className="text-center py-8 text-gray-500"><p className="text-sm">{data?.error || t('error_loading_comments', 'Error loading comments')}</p></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Facebook Comments ({commentsList.length})</h3>
        <button onClick={() => mutate()} className="text-xs text-gray-500 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {commentsList.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p>{t('no_facebook_comments', 'No Facebook comments yet')}</p>
        </div>
      ) : (
        <div className="space-y-0 divide-y divide-tableBorder">
          {commentsList.map((comment: any) => (
            <div key={comment.id} className="py-4 first:pt-0">
              <div className="flex gap-3">
                <Avatar src={comment.author?.picture} name={comment.author?.name || 'User'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">{comment.author?.name || 'Unknown'}</span>
                    <span className="text-xs text-gray-500">{formatTime(comment.createdAt)}</span>
</div>
                  <p className="text-sm text-gray-300 mt-1 break-words">{comment.content}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <button onClick={() => handleReply(comment.id, comment.author?.name || 'User')} className="flex items-center gap-1 text-xs text-gray-500 hover:text-white transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      {t('reply', 'Reply')}
                    </button>
                    {comment.permalinkUrl && (
                      <button onClick={() => openInFacebook(comment.permalinkUrl)} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                        <ExternalLinkIcon />
                        View on Facebook
                      </button>
                    )}
                  </div>
                  
                  {comment.repliesCount > 0 && (
                    <div className="mt-3">
                      <button 
                        onClick={() => toggleReplies(comment.id)}
                        className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        {loadingReplies[comment.id] ? 'Loading...' : expandedReplies[comment.id] ? 'Hide replies' : `View replies (${comment.repliesCount})`}
                      </button>
                      
                      {expandedReplies[comment.id] && repliesData[comment.id] && (
                        <div className="mt-3 space-y-3 pl-4 border-l-2 border-gray-700">
                          {repliesData[comment.id].map((reply: ReplyData) => (
                            <div key={reply.id} className="flex gap-3">
                              <Avatar src={reply.author?.picture} name={reply.author?.name || 'User'} />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-white">{reply.author?.name || 'Unknown'}</span>
                                  <span className="text-xs text-gray-500">{formatTime(reply.createdAt)}</span>
                                </div>
                                <p className="text-sm text-gray-300 mt-1 break-words">{reply.content}</p>
                                <button onClick={() => handleReply(reply.id, reply.author?.name || 'User')} className="flex items-center gap-1 mt-2 text-xs text-gray-500 hover:text-white transition-colors">
                                  {t('reply', 'Reply')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="flex items-center justify-between bg-third px-3 py-2 rounded-md border border-tableBorder mt-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-400">Replying to</span>
            <span className="text-white font-medium">@{replyTo.name}</span>
        <form onSubmit={handleSubmit(onReplySubmit)} className="space-y-3 pt-4 border-t border-tableBorder">
          <div className="flex items-center justify-between bg-third px-3 py-2 rounded-md border border-tableBorder">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">Replying to</span>
              <span className="text-white font-medium">@{replyTo.name}</span>
            </div>
            <button type="button" onClick={cancelReply} className="text-gray-500 hover:text-white transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <button onClick={cancelReply} className="text-gray-500 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          <textarea
            ref={replyTextareaRef}
            {...register('replyMessage', { required: true })}
            className="flex w-full px-3 py-2 text-sm text-white bg-third border border-tableBorder placeholder-gray-500 rounded-md min-h-[80px] resize-none focus:ring-0 outline-none"
            placeholder={t('write_reply', 'Write a reply...')}
          />
          <div className="flex justify-between items-center">
            {submitError && <span className="text-red-400 text-sm">{submitError}</span>}
            {submitSuccess && <span className="text-green-400 text-sm">Reply posted!</span>}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('posting', 'Posting...') : t('post_reply', 'Reply')}
            </Button>
          </div>
        </form>
      )}

    </div>
  );
};