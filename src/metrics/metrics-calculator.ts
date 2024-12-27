// src/utils/metrics-calculator.ts

/**
 * Interface for a single difference between expected and actual values
 */
interface ValueDifference {
    key: string;
    expected: any;
    actual: any;
    path?: string[];  // For nested object differences
    similarity?: number;  // Similarity score for strings
}

/**
 * Result of comparing expected and actual responses
 */
interface ComparisonResult {
    isMatch: boolean;
    differences?: ValueDifference[];
    matchedFields?: string[];  // Fields that matched correctly
    missingFields?: string[];  // Fields in expected but not in actual
    extraFields?: string[];    // Fields in actual but not in expected
}

/**
 * Represents a single test execution result
 */
export interface TestResult {
    isFinished: boolean;
    isSuccess: boolean;
    input: string;
    expectedResponse: any;
    actualResponse: any;
    timeElapsed: number;
    cost: number;
    differences?: ValueDifference[];
    matchedFields?: string[];
    missingFields?: string[];
    extraFields?: string[];
}

/**
 * Aggregated metrics from all test results
 */
export interface MetricsResult {
    // Basic metrics
    totalTests: number;
    successfulTests: number;
    failedTests: number;

    // Time metrics
    averageTime: number;
    minTime: number;
    maxTime: number;
    medianTime: number;

    // Cost metrics
    averageCost: number;
    totalCost: number;
    costPerSuccess: number;

    // Accuracy metrics
    successRate: number;
    precision: number;
    recall: number;
    f1Score: number;

    // Field-level metrics
    fieldSuccessRates: Record<string, number>;
    mostFailedFields: Array<{ field: string; failureRate: number }>;

    // Error distribution
    errorDistribution: Record<string, number>;
}

export class MetricsCalculator {
    /**
     * Calculate string similarity using Levenshtein distance
     */
    private static calculateStringSimilarity(str1: string, str2: string): number {
        const track = Array(str2.length + 1).fill(null).map(() =>
            Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i++) track[0][i] = i;
        for (let j = 0; j <= str2.length; j++) track[j][0] = j;

        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                track[j][i] = Math.min(
                    track[j][i - 1] + 1,
                    track[j - 1][i] + 1,
                    track[j - 1][i - 1] + indicator
                );
            }
        }

        const distance = track[str2.length][str1.length];
        const maxLength = Math.max(str1.length, str2.length);
        return 1 - distance / maxLength;
    }

    /**
     * Check if numbers are "close enough" with relative and absolute tolerance
     */
    private static areNumbersClose(n1: number, n2: number): boolean {
        const relTolerance = 0.1; // 10% relative tolerance
        const absTolerance = 0.1; // Absolute tolerance

        return Math.abs(n1 - n2) <= Math.max(
            absTolerance,
            relTolerance * Math.max(Math.abs(n1), Math.abs(n2))
        );
    }

    /**
     * Deep comparison of objects with path tracking and tolerance for strings and numbers
     */
    private static deepCompare(
        expected: any,
        actual: any,
        path: string[] = [],
        differences: ValueDifference[] = []
    ): boolean {
        // Handle null/undefined cases
        if (expected === actual) return true;
        if (!expected || !actual) {
            differences.push({
                key: path[path.length - 1] || 'root',
                expected,
                actual,
                path: [...path],
                similarity: 0
            });
            return false;
        }

        // Handle different types
        if (typeof expected !== typeof actual) {
            differences.push({
                key: path[path.length - 1] || 'root',
                expected,
                actual,
                path: [...path],
                similarity: 0
            });
            return false;
        }

        // Handle booleans - exact match required
        if (typeof expected === 'boolean') {
            const isMatch = expected === actual;
            if (!isMatch) {
                differences.push({
                    key: path[path.length - 1] || 'root',
                    expected,
                    actual,
                    path: [...path],
                    similarity: 0
                });
            }
            return isMatch;
        }

        // Handle numbers with tolerance
        if (typeof expected === 'number' && typeof actual === 'number') {
            const isClose = this.areNumbersClose(expected, actual);
            const similarity = 1 - Math.min(Math.abs(expected - actual) / Math.max(Math.abs(expected), Math.abs(actual)), 1);

            if (!isClose) {
                differences.push({
                    key: path[path.length - 1] || 'root',
                    expected,
                    actual,
                    path: [...path],
                    similarity
                });
            }
            return similarity > 0;
        }

        // Handle strings with similarity scoring
        if (typeof expected === 'string' && typeof actual === 'string') {
            const similarity = this.calculateStringSimilarity(expected, actual);
            if (similarity < 1) {
                differences.push({
                    key: path[path.length - 1] || 'root',
                    expected,
                    actual,
                    path: [...path],
                    similarity
                });
            }
            return similarity > 0;
        }

        // Handle arrays - length must match exactly
        if (Array.isArray(expected) && Array.isArray(actual)) {
            if (expected.length !== actual.length) {
                differences.push({
                    key: path[path.length - 1] || 'root',
                    expected: `Array(${expected.length})`,
                    actual: `Array(${actual.length})`,
                    path: [...path],
                    similarity: Math.min(expected.length, actual.length) / Math.max(expected.length, actual.length)
                });
                return false; // Array length mismatch is fatal
            }

            // Compare all elements
            return expected.every((item, index) =>
                this.deepCompare(item, actual[index], [...path, index.toString()], differences)
            );
        }

        // Handle objects - keys must match exactly
        if (typeof expected === 'object') {
            const expectedKeys = Object.keys(expected);
            const actualKeys = Object.keys(actual);

            // Check for extra or missing keys
            const missingKeys = expectedKeys.filter(key => !(key in actual));
            const extraKeys = actualKeys.filter(key => !(key in expected));

            if (missingKeys.length > 0 || extraKeys.length > 0) {
                differences.push({
                    key: path[path.length - 1] || 'root',
                    expected: `Object(${expectedKeys.join(', ')})`,
                    actual: `Object(${actualKeys.join(', ')})`,
                    path: [...path],
                    similarity: (expectedKeys.length - missingKeys.length) / Math.max(expectedKeys.length, actualKeys.length)
                });
                return false; // Key mismatch is fatal
            }

            // Compare all values
            return expectedKeys.every(key =>
                this.deepCompare(expected[key], actual[key], [...path, key], differences)
            );
        }

        // Handle other primitives
        const isMatch = expected === actual;
        if (!isMatch) {
            differences.push({
                key: path[path.length - 1] || 'root',
                expected,
                actual,
                path: [...path],
                similarity: 0
            });
        }
        return isMatch;
    }

    /**
     * Compare expected and actual responses
     */
    private static compareResponses(expected: any, actual: any): ComparisonResult {
        try {
            // Parse strings if necessary
            const expectedObj = typeof expected === 'string' ? JSON.parse(expected) : expected;
            const actualObj = typeof actual === 'string' ? JSON.parse(actual) : actual;

            const differences: ValueDifference[] = [];
            const isMatch = this.deepCompare(expectedObj, actualObj, [], differences);

            // Collect field statistics
            const expectedKeys = new Set(this.getAllKeys(expectedObj));
            const actualKeys = new Set(this.getAllKeys(actualObj));

            const matchedFields = [...expectedKeys].filter(key => actualKeys.has(key));
            const missingFields = [...expectedKeys].filter(key => !actualKeys.has(key));
            const extraFields = [...actualKeys].filter(key => !expectedKeys.has(key));

            return {
                isMatch,
                differences: differences.length > 0 ? differences : undefined,
                matchedFields,
                missingFields: missingFields.length > 0 ? missingFields : undefined,
                extraFields: extraFields.length > 0 ? extraFields : undefined
            };
        } catch (error) {
            return {
                isMatch: false,
                differences: [{
                    key: 'parse_error',
                    expected,
                    actual,
                    path: ['root']
                }]
            };
        }
    }

    /**
     * Get all keys from an object (including nested)
     */
    private static getAllKeys(obj: any, prefix: string = ''): string[] {
        if (!obj || typeof obj !== 'object') return [];

        return Object.entries(obj).flatMap(([key, value]) => {
            const currentKey = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return [currentKey, ...this.getAllKeys(value, currentKey)];
            }
            return [currentKey];
        });
    }

    /**
     * Calculate percentile of an array
     */
    private static getPercentile(arr: number[], percentile: number): number {
        const sorted = [...arr].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[index];
    }

    /**
     * Evaluate a single test case
     */
    public static async evaluateTestCase(
        expected: any,
        actual: any,
        timeElapsed: number,
        cost: number,
        input: string
    ): Promise<TestResult> {
        const comparison = this.compareResponses(expected, actual);

        return {
            input,
            expectedResponse: expected,
            actualResponse: actual,
            timeElapsed,
            cost,
            isFinished: true,
            isSuccess: comparison.isMatch,
            differences: comparison.differences,
            matchedFields: comparison.matchedFields,
            missingFields: comparison.missingFields,
            extraFields: comparison.extraFields
        };
    }

    /**
     * Calculate aggregated metrics from test results
     */
    public static calculateMetrics(results: TestResult[]): MetricsResult {
        const totalTests = results.length;
        const successfulTests = results.filter(r => r.isSuccess).length;
        const failedTests = totalTests - successfulTests;

        const times = results.filter(r => r.isFinished).map(r => r.timeElapsed);
        const costs = results.filter(r => r.isFinished).map(r => r.cost);

        // Calculate field-level success rates
        const fieldCounts = new Map<string, { success: number; total: number }>();

        results.forEach(result => {
            if (result.matchedFields) {
                result.matchedFields.forEach(field => {
                    const counts = fieldCounts.get(field) || { success: 0, total: 0 };
                    counts.success += result.isSuccess ? 1 : 0;
                    counts.total += 1;
                    fieldCounts.set(field, counts);
                });
            }
        });

        const fieldSuccessRates = Object.fromEntries(
            Array.from(fieldCounts.entries()).map(([field, counts]) => [
                field,
                counts.success / counts.total
            ])
        );

        const mostFailedFields = Array.from(fieldCounts.entries())
            .map(([field, counts]) => ({
                field,
                failureRate: 1 - (counts.success / counts.total)
            }))
            .sort((a, b) => b.failureRate - a.failureRate)
            .slice(0, 5);

        // Calculate error distribution
        const errorDistribution = results
            .filter(r => !r.isSuccess && r.differences)
            .reduce((acc, result) => {
                result.differences!.forEach(diff => {
                    const key = diff.key;
                    acc[key] = (acc[key] || 0) + 1;
                });
                return acc;
            }, {} as Record<string, number>);

        return {
            // Basic metrics
            totalTests,
            successfulTests,
            failedTests,

            // Time metrics
            averageTime: times.reduce((a, b) => a + b, 0) / totalTests,
            minTime: Math.min(...times),
            maxTime: Math.max(...times),
            medianTime: this.getPercentile(times, 50),

            // Cost metrics
            averageCost: costs.reduce((a, b) => a + b, 0) / totalTests,
            totalCost: costs.reduce((a, b) => a + b, 0),
            costPerSuccess: successfulTests ?
                costs.reduce((a, b) => a + b, 0) / successfulTests : 0,

            // Accuracy metrics
            successRate: successfulTests / totalTests,
            precision: successfulTests / totalTests,
            recall: successfulTests / totalTests,
            f1Score: successfulTests ?
                (2 * (successfulTests / totalTests) * (successfulTests / totalTests)) /
                ((successfulTests / totalTests) + (successfulTests / totalTests)) : 0,

            // Field-level metrics
            fieldSuccessRates,
            mostFailedFields,

            // Error distribution
            errorDistribution
        };
    }
}
