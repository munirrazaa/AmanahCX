import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';

const publicApi = axios.create({ baseURL: (import.meta as any).env?.VITE_API_URL ?? '' });

interface SurveyMeta {
  ticketNumber: string;
  subject: string;
  companyName: string;
  reporterName: string;
  alreadyRated: boolean;
  rating: number | null;
}

const STARS = [1, 2, 3, 4, 5];
const LABELS: Record<number, string> = {
  1: 'Very dissatisfied',
  2: 'Dissatisfied',
  3: 'Neutral',
  4: 'Satisfied',
  5: 'Very satisfied',
};
const STAR_COLORS: Record<number, string> = {
  1: 'text-red-400',
  2: 'text-orange-400',
  3: 'text-yellow-400',
  4: 'text-blue-400',
  5: 'text-emerald-400',
};

export default function CsatSurvey() {
  const { token } = useParams<{ token: string }>();
  const [hover, setHover]     = useState(0);
  const [rating, setRating]   = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery<SurveyMeta>({
    queryKey: ['csat-survey', token],
    queryFn: async () => (await publicApi.get(`/public/csat/${token}`)).data.data,
    retry: false,
  });

  const submitMut = useMutation({
    mutationFn: () => publicApi.post(`/public/csat/${token}`, { rating, comment: comment || undefined }),
    onSuccess: () => setSubmitted(true),
  });

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  );

  if (error || !data) {
    const status = (error as any)?.response?.status;
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="text-4xl mb-4">{status === 410 ? '⏰' : '🔍'}</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            {status === 410 ? 'Survey Expired' : 'Survey Not Found'}
          </h2>
          <p className="text-gray-500 text-sm">
            {status === 410
              ? 'This satisfaction survey has expired. Thank you for your time.'
              : 'This link is invalid or has already been used.'}
          </p>
        </div>
      </div>
    );
  }

  if (submitted || data.alreadyRated) {
    const finalRating = submitted ? rating : (data.rating ?? 0);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🙏</div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Thank you for your feedback!</h2>
          <p className="text-gray-500 text-sm mb-4">
            Your response helps {data.companyName} improve their service.
          </p>
          {finalRating > 0 && (
            <div className="flex justify-center gap-1 mt-2">
              {STARS.map(s => (
                <span key={s} className={`text-2xl ${s <= finalRating ? STAR_COLORS[finalRating] : 'text-gray-200'}`}>★</span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const activeColor = hover > 0 ? STAR_COLORS[hover] : rating > 0 ? STAR_COLORS[rating] : 'text-gray-300';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">{data.companyName}</p>
          <h1 className="text-xl font-bold text-gray-900 mb-1">How did we do?</h1>
          <p className="text-sm text-gray-500">
            Hi {data.reporterName || 'there'} — please rate your experience with ticket{' '}
            <span className="font-mono font-semibold text-gray-700">{data.ticketNumber}</span>
          </p>
          <p className="text-xs text-gray-400 mt-1 truncate">{data.subject}</p>
        </div>

        {/* Star rating */}
        <div className="flex justify-center gap-2 mb-2">
          {STARS.map(s => (
            <button
              key={s}
              onClick={() => setRating(s)}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(0)}
              className={`text-4xl transition-transform hover:scale-110 focus:outline-none ${
                s <= (hover || rating) ? (STAR_COLORS[hover || rating]) : 'text-gray-200'
              }`}
            >
              ★
            </button>
          ))}
        </div>

        {/* Rating label */}
        <p className={`text-center text-sm font-medium mb-5 h-5 transition-all ${activeColor}`}>
          {(hover || rating) > 0 ? LABELS[hover || rating] : ''}
        </p>

        {/* Comment */}
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Any additional comments? (optional)"
          rows={3}
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />

        {/* Submit */}
        <button
          disabled={rating === 0 || submitMut.isPending}
          onClick={() => submitMut.mutate()}
          className="mt-4 w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-700 text-white"
        >
          {submitMut.isPending ? 'Submitting…' : 'Submit Feedback'}
        </button>

        {submitMut.isError && (
          <p className="text-xs text-red-500 text-center mt-2">Something went wrong. Please try again.</p>
        )}
      </div>
    </div>
  );
}
