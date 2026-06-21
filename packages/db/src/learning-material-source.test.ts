import assert from 'node:assert/strict';

import {
  LearningMaterialType,
  ParseEntityKind,
  SourceDocumentType,
  SourceUnitKind,
} from './index.ts';

assert.equal(SourceDocumentType.exam_paper, 'exam_paper');
assert.equal(SourceDocumentType.lesson_handout, 'lesson_handout');
assert.equal(SourceUnitKind.slide, 'slide');
assert.equal(LearningMaterialType.method_card, 'method_card');
assert.equal(LearningMaterialType.common_mistake, 'common_mistake');
assert.equal(ParseEntityKind.learning_material, 'learning_material');
