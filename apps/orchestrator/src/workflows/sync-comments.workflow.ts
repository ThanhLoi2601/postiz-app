import { proxyActivities, sleep } from '@temporalio/workflow';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';

const { getPublishedPostsWithFacebook, syncPostComments } =
  proxyActivities<IntegrationsActivity>({
    startToCloseTimeout: '5 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '1 minute',
    },
  });

const BATCH_SIZE = 5;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export async function syncCommentsWorkflow() {
  console.log('[SyncCommentsWorkflow] Starting workflow');

  while (true) {
    try {
      console.log(
        '[SyncCommentsWorkflow] Fetching published posts with Facebook...',
      );
      const posts = await getPublishedPostsWithFacebook();

      if (!posts || posts.length === 0) {
        console.log('[SyncCommentsWorkflow] No posts found, skipping...');
      } else {
        console.log(
          `[SyncCommentsWorkflow] Found ${posts.length} posts, processing in batches of ${BATCH_SIZE}...`,
        );

        for (let i = 0; i < posts.length; i += BATCH_SIZE) {
          const batch = posts.slice(i, i + BATCH_SIZE);
          console.log(
            `[SyncCommentsWorkflow] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}: posts ${i + 1}-${i + batch.length}`,
          );

          const results = await Promise.allSettled(
            batch.map(async (post: any) => {
              try {
                const result = await syncPostComments(post.id);
                return { postId: post.id, ...result };
              } catch (error) {
                return {
                  postId: post.id,
                  success: false,
                  error: String(error),
                };
              }
            }),
          );

          const successCount = results.filter(
            (r: any) => r.status === 'fulfilled' && r.value?.success,
          ).length;
          const failCount = results.length - successCount;
          console.log(
            `[SyncCommentsWorkflow] Batch complete: ${successCount} success, ${failCount} failed`,
          );
        }
      }
    } catch (error) {
      console.error('[SyncCommentsWorkflow] Error in main loop:', error);
    }

    console.log(
      `[SyncCommentsWorkflow] Waiting ${SYNC_INTERVAL_MS / 1000 / 60} minutes before next sync...`,
    );
    await sleep(SYNC_INTERVAL_MS);
  }
}
