import React from 'react';
import AnswerReview from './AnswerReview';
import { UserProfile } from '../types';

// The route name remains temporary compatibility only; the view is no longer a diagnosis.
export default function AttemptDiagnosis({ attemptId, currentUser, onBack }: { attemptId: string; currentUser: UserProfile; onBack: () => void }) {
  return <AnswerReview sourceType="paper_attempt" sourceId={attemptId} currentUser={currentUser} onBack={onBack} />;
}
