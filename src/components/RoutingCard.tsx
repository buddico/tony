import type { RoutingResultArgs } from '../types';

interface RoutingCardProps {
  result: RoutingResultArgs | null;
}

export function RoutingCard({ result }: RoutingCardProps) {
  if (!result) {
    return (
      <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
        <div className="text-slate-400">
          <svg
            className="w-12 h-12 mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm">Routing result will appear here</p>
          <p className="text-xs mt-1">Complete the triage conversation</p>
        </div>
      </div>
    );
  }

  const isEmergency = result.isEmergency;

  return (
    <div
      className={`rounded-xl border-2 p-6 ${
        isEmergency
          ? 'bg-red-50 border-red-500'
          : 'bg-emerald-50 border-emerald-500'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {isEmergency ? (
          <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        ) : (
          <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        )}
        <div>
          <h3
            className={`font-bold text-lg ${
              isEmergency ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {isEmergency ? 'URGENT - Emergency Routing' : 'Triage Complete'}
          </h3>
          <p className="text-sm text-slate-600">Routing decision made</p>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-3">
        <div className="flex justify-between items-start">
          <span className="text-slate-600 font-medium">Service:</span>
          <span
            className={`font-bold ${
              isEmergency ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {result.service}
          </span>
        </div>

        <div className="flex justify-between items-start">
          <span className="text-slate-600 font-medium">Appointment:</span>
          <span className="text-slate-800">{result.appointment || 'N/A'}</span>
        </div>

        {result.redFlags && (
          <div className="pt-2 border-t border-slate-200">
            <span className="text-red-600 font-medium text-sm">
              Red Flags Identified:
            </span>
            <p className="text-red-700 text-sm mt-1">{result.redFlags}</p>
          </div>
        )}

        {result.notes && (
          <div className="pt-2 border-t border-slate-200">
            <span className="text-slate-600 font-medium text-sm">Notes:</span>
            <p className="text-slate-700 text-sm mt-1">{result.notes}</p>
          </div>
        )}

        <div className="pt-2 border-t border-slate-200">
          <span className="text-slate-600 font-medium text-sm">Rationale:</span>
          <p className="text-slate-700 text-sm mt-1">{result.rationale}</p>
        </div>
      </div>
    </div>
  );
}
