import React, { useEffect, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';
import './QuestionSequence.css';

export default function QuestionSequence({ questions = [], eyebrow = 'Concept Checkpoint' }) {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const questionRef = useRef(null);
  const optionRefs = useRef({});
  const explanationRef = useRef(null);

  const currentQuestion = questions[questionIndex] ?? null;
  const selectedOption = currentQuestion?.options.find((option) => option.id === selectedOptionId) ?? null;
  const isCorrect = Boolean(selectedOption?.isCorrect);
  const isComplete = questions.length > 0 && questionIndex === questions.length - 1 && hasSubmitted && isCorrect;

  const renderMath = (element) => {
    if (!element) return;

    renderMathInElement(element, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      throwOnError: false,
    });
  };

  useEffect(() => {
    if (!currentQuestion) return;

    if (typeof currentQuestion.question === 'string') {
      renderMath(questionRef.current);
    }

    currentQuestion.options.forEach((option) => {
      if (typeof option.text === 'string') {
        renderMath(optionRefs.current[option.id]);
      }
    });
  }, [currentQuestion]);

  useEffect(() => {
    if (!hasSubmitted || !selectedOption || !explanationRef.current) return;
    if (typeof selectedOption.explanation !== 'string') return;

    renderMath(explanationRef.current);
  }, [hasSubmitted, selectedOption]);

  if (!currentQuestion) {
    return null;
  }

  const handleSelect = (optionId) => {
    setSelectedOptionId(optionId);
    setHasSubmitted(true);
  };

  const handleNext = () => {
    if (!isCorrect) return;
    if (questionIndex >= questions.length - 1) return;

    setQuestionIndex((index) => index + 1);
    setSelectedOptionId(null);
    setHasSubmitted(false);
    optionRefs.current = {};
  };

  return (
    <section className="checkpoint not-prose my-12 border-t border-[var(--grid-line)] pt-6 text-[color:var(--text-primary)]">
      <p className="mb-4 flex items-baseline gap-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
        {eyebrow}
        {questions.length > 1 && (
          <span className="font-medium normal-case tracking-normal text-[var(--text-muted)]">
            {questionIndex + 1} of {questions.length}
          </span>
        )}
      </p>

      <div ref={questionRef} className="mb-5 text-lg font-semibold leading-relaxed">
        {currentQuestion.question}
      </div>

      <div className="space-y-2">
        {currentQuestion.options.map((option, index) => {
          const isSelected = option.id === selectedOptionId;
          const isSelectedCorrect = hasSubmitted && isSelected && option.isCorrect;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option.id)}
              aria-pressed={isSelected}
              data-result={hasSubmitted && isSelected ? (isSelectedCorrect ? 'correct' : 'incorrect') : undefined}
              className="checkpoint-option group flex w-full items-start gap-3 rounded-[var(--radius-control)] border p-3 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-blue)]"
            >
              <span
                className="checkpoint-letter mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors"
              >
                {String.fromCharCode(65 + index)}
              </span>
              <span
                ref={(element) => {
                  optionRefs.current[option.id] = element;
                }}
                className="flex-1 text-base leading-relaxed"
              >
                {option.text}
              </span>
              {hasSubmitted && isSelected && (
                <svg
                  className="mt-1.5 h-5 w-5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  role="img"
                  aria-label={isSelectedCorrect ? 'Correct answer' : 'Incorrect answer'}
                >
                  <path d={isSelectedCorrect ? 'm5 12 4 4 10-10' : 'm6 6 12 12M6 18 18 6'} />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {hasSubmitted && isCorrect && !isComplete && (
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={handleNext}
            className="rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-semibold text-white transition-[filter] duration-200 hover:brightness-110"
          >
            Next question
          </button>
        </div>
      )}

      {hasSubmitted && selectedOption && (
        <div
          data-result={isCorrect ? 'correct' : 'incorrect'}
          className="explanation mt-5 border-l-2 pl-4"
        >
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
            Explanation
          </p>
          <div ref={explanationRef} className="text-sm leading-7 text-[color:var(--text-primary)]">
            {selectedOption.explanation}
          </div>
        </div>
      )}
    </section>
  );
}
