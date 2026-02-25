import {
	normalizeNetworkData as normalizeNetworkDataCore,
	validateNetworkData as validateNetworkDataCore
} from '../shared/networkSchemaCore.mjs';
import type { NetworkData } from '../types';

export interface ValidationIssue {
	path: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationIssue[];
	data?: NetworkData;
}

export function validateNetworkData(value: unknown): ValidationResult {
	return validateNetworkDataCore(value) as ValidationResult;
}

export function normalizeNetworkData(data: NetworkData): NetworkData {
	return normalizeNetworkDataCore(data) as NetworkData;
}
