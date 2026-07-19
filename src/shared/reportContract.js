/**
 * Factory helpers that enforce the Report Format Contract and
 * Problem Reporting Contract defined in types.js. Any agent/module
 * that needs to hand a report up the chain should build it through
 * these factories so the shape never drifts.
 */

/**
 * @param {Partial<import('./types.js').ReportContract>} input
 * @returns {import('./types.js').ReportContract}
 */
export function createReport(input = {}) {
  return {
    task: input.task ?? "",
    filesAdded: input.filesAdded ?? [],
    filesModified: input.filesModified ?? [],
    architectureDecisions: input.architectureDecisions ?? [],
    limitations: input.limitations ?? [],
    buildStatus: input.buildStatus ?? "",
    nextRecommendation: input.nextRecommendation ?? "",
    problemReport: input.problemReport ?? null,
  };
}

/**
 * @param {Partial<import('./types.js').ProblemReportContract>} input
 * @returns {import('./types.js').ProblemReportContract}
 */
export function createProblemReport(input = {}) {
  return {
    problem: input.problem ?? "",
    impact: input.impact ?? "",
    whyItMatters: input.whyItMatters ?? "",
    suggestedFix: input.suggestedFix ?? "",
    blocker: Boolean(input.blocker),
  };
}
