import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import {
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY,
} from '$env/static/public';
import {
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_ACCOUNT_ID,
  R2_BUCKET_NAME,
} from '$env/static/private';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit } from '$lib/rateLimit';

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

export const DELETE: RequestHandler = async ({ request }) => {
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ACCOUNT_ID || !R2_BUCKET_NAME) {
    throw error(501, 'Avatar storage not configured');
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw error(401, 'Not authenticated');
  }
  const token = authHeader.slice(7);

  const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    throw error(401, 'Not authenticated');
  }

  const rl = checkRateLimit('avatar-delete', user.id, 10, 3600_000);
  if (!rl.allowed) {
    throw error(429, 'Too many requests. Try again later.');
  }

  // Delete any avatar object for this user regardless of extension
  const extensions = ['jpg', 'png', 'webp', 'avif', 'gif'];
  const keys = extensions.map(ext => `avatars/${user.id}.${ext}`);

  await Promise.allSettled(
    keys.map(key =>
      getS3().send(new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      }))
    )
  );

  return json({ success: true });
};
