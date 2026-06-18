export function isAllowedStorageReadKey(key: string): boolean {
  return (
    key.startsWith('derived/') && !key.startsWith('/') && !key.includes('..') && !key.includes('\\')
  );
}

export function contentTypeForStorageKey(key: string): string {
  const lowerKey = key.toLowerCase();
  if (lowerKey.endsWith('.png')) return 'image/png';
  if (lowerKey.endsWith('.jpg') || lowerKey.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerKey.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
