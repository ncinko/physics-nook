import React, { useEffect, useRef, useState } from 'react';
import renderMathInElement from 'katex/contrib/auto-render';

export default function MultipleChoice({ question, options = [] }) {
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const questionRef = useRef(null);
  const optionRefs = useRef({});
  const explanationRef = useRef(null);

  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? null;

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
    if (typeof question === 'string') {
      renderMath(questionRef.current);
    }

    options.forEach((option) => {
      if (typeof option.text === 'string') {
        renderMath(optionRefs.current[option.id]);
      }
    });
  }, [question, options]);

  useEffect(() => {
    if (!hasSubmitted || !selectedOption || !explanationRef.current) return;
    if (typeof selectedOption.explanation !== 'string') return;

    renderMath(explanationRef.current);
  }, [hasSubmitted, selectedOption]);

  const handleSelect = (optionId) => {
    setSelectedOptionId(optionId);
    setHasSubmitted(true);
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
      <div ref={questionRef} className="mb-5 text-lg font-semibold leading-relaxed">
        {question}
      </div>

      <div className="space-y-3">
        {options.map((option, index) => {
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

      <p className="mt-5 text-sm text-gray-500">
        {hasSubmitted
          ? selectedOption?.isCorrect
            ? 'Correct. Nice work.'
            : 'Not quite. Review the explanation below.'
          : 'Choose an answer to get instant feedback.'}
      </p>

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
