import { NotFoundError, createStore } from '@hao/storage';
import { contentTypeForStorageKey, isAllowedStorageReadKey } from '../../../lib/storage-route';

interface RouteContext {
  params: Promise<{
    key: string[];
  }>;
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
  const { key: keyParts } = await params;
  const key = keyParts.join('/');

  if (!isAllowedStorageReadKey(key)) {
    return new Response('Not found', { status: 404 });
  }

  try {
    const body = await createStore().get(key);
    return new Response(new Uint8Array(body), {
      headers: {
        'cache-control': 'private, max-age=300',
        'content-type': contentTypeForStorageKey(key),
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return new Response('Not found', { status: 404 });
    }
    throw error;
  }
}
