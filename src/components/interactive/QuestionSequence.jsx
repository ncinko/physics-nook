import React, { useEffect, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';

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

  const getOptionClasses = (option) => {
    const isSelected = option.id === selectedOptionId;
    const isSelectedCorrect = hasSubmitted && isSelected && option.isCorrect;
    const isSelectedWrong = hasSubmitted && isSelected && !option.isCorrect;

    if (isSelectedCorrect) {
      return 'border-green-500 bg-green-100 text-green-950';
    }

    if (isSelectedWrong) {
      return 'border-red-500 bg-red-100 text-red-950';
    }

    if (isSelected) {
      return 'border-[var(--accent-blue)] bg-[color-mix(in_srgb,var(--accent-blue)_12%,white)] shadow-sm';
    }

    return 'border-[var(--grid-line)] bg-[var(--bg-primary)] hover:-translate-y-0.5 hover:shadow-md';
  };

  return (
    <section className="not-prose rounded-3xl border border-[var(--grid-line)] bg-[color:var(--sim-bg)] p-5 text-[color:var(--text-primary)] shadow-sm md:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-blue)]">
          {eyebrow}
        </p>
        <p className="rounded-full border border-[var(--grid-line)] bg-[var(--bg-primary)] px-3 py-1 text-xs font-medium text-[var(--text-muted)]">
          Question {questionIndex + 1} of {questions.length}
        </p>
      </div>

      <div ref={questionRef} className="mb-5 text-lg font-semibold leading-relaxed">
        {currentQuestion.question}
      </div>

      <div className="space-y-3">
        {currentQuestion.options.map((option, index) => {
          const isSelected = option.id === selectedOptionId;
          const isSelectedCorrect = hasSubmitted && isSelected && option.isCorrect;
          const isSelectedWrong = hasSubmitted && isSelected && !option.isCorrect;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option.id)}
              className={`group flex w-full items-start gap-4 rounded-2xl border p-4 text-left transition-all duration-300 ${getOptionClasses(option)}`}
            >
              <span
                className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
                  isSelectedCorrect
                    ? 'border-green-500 bg-green-500 text-white'
                    : isSelectedWrong
                      ? 'border-red-500 bg-red-500 text-white'
                      : isSelected
                        ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                        : 'border-[var(--grid-line)] bg-white text-[color:var(--text-primary)]'
                }`}
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
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          {hasSubmitted
            ? isCorrect
              ? isComplete
                ? 'Correct. You finished the sequence.'
                : 'Correct. Move on to the next concept.'
              : 'Not quite. Review the explanation and try again.'
            : 'Choose an answer to get instant feedback.'}
        </p>

        {hasSubmitted && isCorrect && !isComplete && (
          <button
            type="button"
            onClick={handleNext}
            className="rounded-full bg-[var(--accent-blue)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
          >
            Next Question
          </button>
        )}
      </div>

      {hasSubmitted && selectedOption && (
        <div className="explanation mt-5 rounded-2xl border border-[var(--grid-line)] bg-[var(--bg-primary)] p-4 shadow-sm">
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
