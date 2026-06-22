import type { UploadFilePreview } from '../../../../../lib/upload-file-preview';

interface OriginalFilePreviewPanelProps {
  uploadId: string;
  originalName: string | null;
  preview: UploadFilePreview;
  initialPage?: number | null;
  pageNumbers?: number[];
}

export function OriginalFilePreviewPanel({
  uploadId,
  originalName,
  preview,
  initialPage,
  pageNumbers = [],
}: OriginalFilePreviewPanelProps) {
  const fileUrl = `/admin/uploads/${encodeURIComponent(uploadId)}/file`;
  const title = originalName ?? '原始上传文件';

  return (
    <aside className="border rounded-lg overflow-hidden bg-white dark:bg-black lg:sticky lg:top-16">
      <div className="min-w-0 px-3 py-2 border-b flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <p className="text-xs opacity-60">{preview.label}</p>
        </div>
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-xs px-2 py-1 rounded border hover:bg-black/5 dark:hover:bg-white/10"
        >
          新标签打开
        </a>
      </div>
      <div className="h-[68vh] min-h-[28rem] bg-black/5 dark:bg-white/5">
        {preview.kind === 'pdf' ? (
          pageNumbers.length > 0 ? (
            <div className="h-full w-full overflow-y-auto p-3 space-y-3">
              {pageNumbers.map((pageNumber) => (
                <figure
                  key={pageNumber}
                  id={`source-page-${pageNumber}`}
                  className={
                    pageNumber === initialPage
                      ? 'border-2 border-blue-500 rounded bg-white p-2'
                      : 'border rounded bg-white p-2'
                  }
                >
                  <figcaption className="mb-2 text-xs text-black/60">第 {pageNumber} 页</figcaption>
                  <img
                    src={`/admin/uploads/${encodeURIComponent(uploadId)}/pdf-pages/${pageNumber}`}
                    alt={`${title} 第 ${pageNumber} 页`}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full"
                  />
                </figure>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <div className="max-w-sm space-y-3">
                <p className="text-sm opacity-70">暂时无法确定 PDF 页数。</p>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex px-3 py-2 rounded bg-black text-white text-sm font-medium dark:bg-white dark:text-black"
                >
                  打开原始 PDF
                </a>
              </div>
            </div>
          )
        ) : null}
        {preview.kind === 'image' ? (
          <div className="h-full w-full overflow-auto p-3">
            <img
              src={fileUrl}
              alt={title}
              className="mx-auto max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}
        {preview.kind === 'open' ? (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <div className="max-w-sm space-y-3">
              <p className="text-sm opacity-70">该文件格式无法在浏览器内稳定预览。</p>
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex px-3 py-2 rounded bg-black text-white text-sm font-medium dark:bg-white dark:text-black"
              >
                打开原始文件
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
