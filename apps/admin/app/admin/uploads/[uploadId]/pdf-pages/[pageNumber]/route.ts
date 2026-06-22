import { prisma } from '@hao/db';
import { NotFoundError, createStore } from '@hao/storage';
import { renderPdfPageToPng } from '@hao/storage/figure-crop';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '../../../../../../lib/auth';
import { resolveUploadFilePreview } from '../../../../../../lib/upload-file-preview';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ uploadId: string; pageNumber: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.redirect(new URL('/admin/login', request.url), { status: 303 });
  }

  const { uploadId, pageNumber } = await params;
  const parsedPageNumber = Number(pageNumber);
  if (!Number.isInteger(parsedPageNumber) || parsedPageNumber <= 0) {
    return new NextResponse('页码无效', { status: 400 });
  }

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
  if (preview.kind !== 'pdf') {
    return new NextResponse('上传文件不是 PDF', { status: 400 });
  }

  try {
    const sourcePdf = await createStore().get(upload.file_uri);
    const page = await renderPdfPageToPng({
      sourcePdf,
      pageNumber: parsedPageNumber,
      dpi: 144,
    });

    return new NextResponse(new Uint8Array(page.png), {
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'Content-Length': String(page.png.byteLength),
        'Content-Type': 'image/png',
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new NextResponse('原始文件不存在', { status: 404 });
    }
    throw error;
  }
}
