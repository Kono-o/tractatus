import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
  R2_PUBLIC_URL,
} from '$env/static/private';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit } from '$lib/rateLimit';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

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

export const POST: RequestHandler = async ({ request }) => {
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_PUBLIC_URL) {
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

  const rl = checkRateLimit('avatar-upload', user.id, 5, 3600_000);
  if (!rl.allowed) {
    throw error(429, 'Too many uploads. Try again later.');
  }

  const formData = await request.formData();
  const file = formData.get('avatar') as File | null;
  if (!file) {
    throw error(400, 'No file provided');
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    throw error(400, 'Invalid file type. Accepted: JPEG, PNG, WebP, AVIF, GIF');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw error(400, 'File too large. Maximum 2 MB');
  }

  const ext = file.type === 'image/jpeg' ? 'jpg'
    : file.type === 'image/avif' ? 'avif'
    : file.type === 'image/gif' ? 'gif'
    : 'png';

  const key = `avatars/${user.id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  await getS3().send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: file.type,
  }));

  const publicUrl = `${R2_PUBLIC_URL.replace(/\/+$/, '')}/${key}`;

  return json({ url: publicUrl });
};
