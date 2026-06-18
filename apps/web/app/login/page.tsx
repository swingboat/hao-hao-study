import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const errorMessage =
    params.error === 'consent_required' ? '账号尚未完成监护人同意确认，请联系老师处理。' : null;

  return (
    <main className="page-shell center-shell">
      <div className="auth-wrap">
        {errorMessage ? (
          <p className="notice danger" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <LoginForm next={params.next ?? '/'} />
      </div>
    </main>
  );
}
