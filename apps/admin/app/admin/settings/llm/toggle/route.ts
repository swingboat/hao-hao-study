import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '../../../../../lib/auth';
import { setLlmProviderEnabled } from '../../../../../lib/llm-providers';

export async function POST(request: NextRequest) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session) {
    return NextResponse.redirect(new URL('/admin/login?next=/admin/settings/llm', request.url), {
      status: 303,
    });
  }

  const formData = await request.formData();
  const id = String(formData.get('id') ?? '');
  const next = String(formData.get('next') ?? '') === 'true';
  if (!id) {
    return new NextResponse('Provider id 缺失', { status: 400 });
  }

  await setLlmProviderEnabled(id, next);
  revalidatePath('/admin/settings/llm');

  return NextResponse.redirect(new URL('/admin/settings/llm', request.url), { status: 303 });
}
