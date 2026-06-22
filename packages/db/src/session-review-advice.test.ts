import assert from 'node:assert/strict';

import { SessionReviewAdviceStatus } from './index.ts';

assert.equal(SessionReviewAdviceStatus.pending, 'pending');
assert.equal(SessionReviewAdviceStatus.generated, 'generated');
assert.equal(SessionReviewAdviceStatus.failed, 'failed');
