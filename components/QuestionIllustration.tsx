import React from 'react';

export default function QuestionIllustration({ illustration }: { illustration?: { description: string; svg: string } }) {
  if (!illustration) return null;
  // An image document cannot execute inline SVG scripts in the host page.
  return <img className="my-4 h-auto max-h-72 max-w-full border border-slate-200 bg-white object-contain" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(illustration.svg)}`} alt={illustration.description} />;
}
