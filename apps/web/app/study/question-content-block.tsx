import type { QuestionContentPart } from '../../lib/question-content';

interface QuestionContentBlockProps {
  parts: readonly QuestionContentPart[];
}

export function QuestionContentBlock({ parts }: QuestionContentBlockProps) {
  return (
    <div className="question-content-block">
      {parts.map((part) =>
        part.type === 'text' ? (
          <p className="question-content-text" key={`text-${part.text}`}>
            {part.text}
          </p>
        ) : (
          <figure className="question-figure" key={`figure-${part.id}-${part.description}`}>
            {part.imageUrl ? <img alt={part.description} src={part.imageUrl} /> : null}
            <figcaption>
              <span>题图</span>
              {part.description}
            </figcaption>
          </figure>
        ),
      )}
    </div>
  );
}
