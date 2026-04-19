'use client';

import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { FC, useCallback, useMemo, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { FieldValues, SubmitHandler, useForm } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

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

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

const Avatar = ({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base',
  };
  
  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold`}
    >
      {getInitials(name)}
    </div>
  );
};

export const RenderComponents: FC<{
  postId: string;
}> = (props) => {
  const { postId } = props;
  const fetch = useFetch();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [replyTo, setReplyTo] = useState<{ userId: number; name: string } | null>(null);
  
  const comments = useCallback(async () => {
    return (await fetch(`/public/posts/${postId}/comments`)).json();
  }, [postId, fetch]);
  const { data, mutate, isLoading } = useSWR(`comments-${postId}`, comments);
  
  const { handleSubmit, register, setValue, reset } = useForm();
  
  const submit: SubmitHandler<FieldValues> = useCallback(
    async (e) => {
      const commentText = e.comment;
      setValue('comment', '');
      setReplyTo(null);
      await fetch(`/posts/${postId}/comments`, {
        method: 'POST',
        body: JSON.stringify(replyTo ? { comment: `@${replyTo.name} ${commentText}`, replyToId: replyTo.userId } : e),
      });
      mutate();
    },
    [postId, mutate, replyTo, fetch]
  );

  const handleReply = useCallback((userId: number, name: string) => {
    setReplyTo({ userId, name });
    textareaRef.current?.focus();
  }, []);

  const cancelReply = useCallback(() => {
    setReplyTo(null);
    reset();
  }, [reset]);

  const t = useT();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const commentsList = data?.comments || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          {t('comments', 'Comments')} ({commentsList.length})
        </h3>
      </div>

      {commentsList.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-12 w-12 mx-auto mb-3 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p>{t('no_comments_yet', 'No comments yet. Be the first to comment!')}</p>
        </div>
      ) : (
        <div className="space-y-0 divide-y divide-tableBorder">
          {commentsList.map((comment: any) => (
            <div key={comment.id} className="py-4 first:pt-0">
              <div className="flex gap-3">
                <Avatar name={`User ${comment.userId}`} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-white">
                      {t('user', 'User')} {comment.userId}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatTime(comment.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300 mt-1 break-words">
                    {comment.content}
                  </p>
                  <button
                    onClick={() => handleReply(comment.userId, `User ${comment.userId}`)}
                    className="flex items-center gap-1 mt-2 text-xs text-gray-500 hover:text-white transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                      />
                    </svg>
                    {t('reply', 'Reply')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="space-y-3 pt-4 border-t border-tableBorder" onSubmit={handleSubmit(submit)}>
        {replyTo && (
          <div className="flex items-center justify-between bg-third px-3 py-2 rounded-md border border-tableBorder">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">Replying to</span>
              <span className="text-white font-medium">@{replyTo.name}</span>
            </div>
            <button
              type="button"
              onClick={cancelReply}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          {...register('comment', {
            required: true,
          })}
          className="flex w-full px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[80px] resize-none text-white bg-third border border-tableBorder placeholder-gray-500 focus:ring-0 rounded-md"
          placeholder={t('write_comment', 'Write a comment...')}
          defaultValue={''}
        />
        <div className="flex justify-end">
          <Button type="submit">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={24}
              height={24}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-send me-2 h-4 w-4"
            >
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
            {t('post', 'Post')}
          </Button>
        </div>
      </form>
    </div>
  );
};

export const CommentsComponents: FC<{
  postId: string;
}> = (props) => {
  const user = useUser();
  const t = useT();

  const { postId } = props;
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
  return <RenderComponents postId={postId} />;
};