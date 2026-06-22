import { prisma } from '@hao/db';
import { NotFoundError, createStore } from '@hao/storage';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '../../../../../lib/auth';
import {
  buildInlineContentDisposition,
  resolveUploadFilePreview,
} from '../../../../../lib/upload-file-preview';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ uploadId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.redirect(new URL('/admin/login', request.url), { status: 303 });
  }

  const { uploadId } = await params;
  const upload = await prisma.content_upload.findUnique({
    where: { id: uploadId },
    select: { file_uri: true, file_type: true, original_name: true },
  });

  if (!upload) {
    return new NextResponse('上传文件不存在', { status: 404 });
  }

  const preview = resolveUploadFilePreview({
    originalName: upload.original_name,
    fileType: upload.file_type,
  });

  try {
    const body = await createStore().get(upload.file_uri);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Content-Disposition': buildInlineContentDisposition(upload.original_name),
        'Content-Length': String(body.byteLength),
        'Content-Type': preview.contentType,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new NextResponse('原始文件不存在', { status: 404 });
    }
    throw error;
  }
}
