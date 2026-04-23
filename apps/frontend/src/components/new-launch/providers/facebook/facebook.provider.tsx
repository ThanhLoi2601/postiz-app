'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { Input } from '@gitroom/react/form/input';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { FacebookPreview } from '@gitroom/frontend/components/new-launch/providers/facebook/facebook.preview';
import { useWatch } from 'react-hook-form';
import { useEffect } from 'react';

export const FacebookSettings = () => {
  const { register, control } = useSettings();

  const isPostedOnGroup = useWatch({
    control,
    name: 'isPostedOnGroup',
    defaultValue: false,
  });

  const groupId = useWatch({
    control,
    name: 'groupId',
    defaultValue: '',
  });

  const postId = useWatch({
    control,
    name: 'postId',
    defaultValue: '',
  });

  // Dispatch custom event whenever groupId or postId changes
  useEffect(() => {
    const isFilled = !!(groupId?.trim() && postId?.trim());
    window.dispatchEvent(
      new CustomEvent('facebook-group-post-filled', { detail: { isFilled } })
    );
    // Cleanup: reset when component unmounts
    return () => {
      window.dispatchEvent(
        new CustomEvent('facebook-group-post-filled', {
          detail: { isFilled: false },
        })
      );
    };
  }, [groupId, postId]);

  return (
    <div className="space-y-4">
      <Input label="Embedded URL (only for text Post)" {...register('url')} />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isPostedOnGroup"
          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          {...register('isPostedOnGroup')}
        />
        <label
          htmlFor="isPostedOnGroup"
          className="text-sm font-medium text-gray-700 cursor-pointer"
        >
          Posted on Group
        </label>
      </div>

      {isPostedOnGroup && (
        <div className="space-y-3 pl-6 border-l-2 border-blue-200">
          <Input
            label="Group ID"
            placeholder="Enter Facebook Group ID"
            {...register('groupId')}
          />
          <Input
            label="Post ID"
            placeholder="Enter the posted post ID"
            {...register('postId')}
          />
        </div>
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.COMMENT,
  minimumCharacters: [],
  SettingsComponent: FacebookSettings,
  CustomPreviewComponent: FacebookPreview,
  dto: FacebookDto,
  checkValidity: undefined,
  maximumCharacters: 63206,
});