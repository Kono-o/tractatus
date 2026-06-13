import { createClient, type User } from "@supabase/supabase-js";
import {
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY,
} from "$env/static/public";

const supabaseUrl = PUBLIC_SUPABASE_URL.trim();
const supabaseAnonKey = PUBLIC_SUPABASE_ANON_KEY.trim();

/** False when PUBLIC_* env vars were missing at build time (Vercel 500 without this guard). */
export const isSupabaseConfigured =
	supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

// createClient throws on empty url; placeholder keeps SSR alive until env is set on Vercel.
export const supabase = createClient(
	isSupabaseConfigured ? supabaseUrl : "https://placeholder.supabase.co",
	isSupabaseConfigured ? supabaseAnonKey : "placeholder-anon-key",
	{
		auth: {
			flowType: "pkce",
			detectSessionInUrl: true,
			persistSession: true,
			autoRefreshToken: true,
		},
	},
);

function getOAuthRedirectUrl(): string {
	if (typeof window === "undefined") return "";
	// Native deep link (com.tractatus.app://...) is only used inside the Capacitor
	// Android app (which uses the static adapter → no SSR). For web / SSR we always
	// return the origin callback. This avoids any top-level import of @capacitor/core
	// in db.ts so that core auth never pulls native modules during server rendering.
	const cap = (window as any).Capacitor;
	if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
		return 'com.tractatus.app://auth/callback';
	}
	return `${window.location.origin}/auth/callback`;
}

type AuthProvider = "google" | "github" | "discord" | "x";

function providerLabel(provider: AuthProvider): string {
	if (provider === "google") return "Google";
	if (provider === "github") return "GitHub";
	if (provider === "discord") return "Discord";
	return "X";
}

/** Human-readable message for Supabase auth API errors. */
export function formatAuthError(
	error: unknown,
	provider?: AuthProvider,
	credential?: "email" | "username",
): string {
	const label = provider ? providerLabel(provider) : "OAuth";
	const raw =
		error && typeof error === "object"
			? ("msg" in error && typeof error.msg === "string"
					? error.msg
					: "message" in error && typeof error.message === "string"
						? error.message
						: null)
			: typeof error === "string"
				? error
				: null;

	if (raw?.toLowerCase().includes("provider is not enabled")) {
		return `${label} sign-in is not enabled in your Supabase project. Open the Supabase dashboard → Authentication → Providers, enable ${label}, and add your OAuth client ID and secret.`;
	}

	const code =
		error && typeof error === "object" && "code" in error
			? String(error.code)
			: null;
	const lower = raw?.toLowerCase() ?? "";

	if (
		code === "email_address_invalid" ||
		(lower.includes("email address") && lower.includes("invalid"))
	) {
		return "That username could not be registered. Try a different username or use email sign-in.";
	}
	if (
		code === "over_email_send_rate_limit" ||
		code === "over_request_rate_limit" ||
		lower.includes("rate limit") ||
		lower.includes("too many requests")
	) {
		return "Email rate limit exceeded — Supabase only allows a few auth emails per hour on the free mailer. Wait about an hour, use username or OAuth sign-in, or in the Supabase dashboard turn off Authentication → Email → Confirm email (and use custom SMTP for real email sign-up).";
	}
	if (lower.includes("email not confirmed")) {
		return "Confirm your email first — check your inbox for the sign-up link.";
	}
	if (lower.includes("invalid login credentials")) {
		if (credential === "email") return "Incorrect email or password.";
		if (credential === "username") return "Incorrect username or password.";
		return "Incorrect sign-in credentials.";
	}
	if (
		code === "23505" ||
		lower.includes("unique constraint") ||
		lower.includes("usernames_pkey") ||
		lower.includes("duplicate key")
	) {
		if (credential === "email") {
			return "An account with this email already exists. Sign in instead.";
		}
		return "This username is already taken. Sign in instead.";
	}
	if (
		code === "user_already_exists" ||
		code === "email_exists" ||
		lower.includes("user already registered") ||
		lower.includes("already registered") ||
		lower.includes("already been registered")
	) {
		if (credential === "email") {
			return "An account with this email already exists. Sign in instead.";
		}
		return "This username is already taken. Sign in instead.";
	}
	if (code === "user_not_found" || lower.includes("user not found")) {
		if (credential === "email") return "No account with this email. Sign up first.";
		if (credential === "username") return "No account with this username. Sign up first.";
	}
	if (lower.includes("password") && lower.includes("least") && raw) {
		return raw;
	}
	if (code === "weak_password" || lower.includes("weak password")) {
		return "Password is too weak. Use at least 6 characters.";
	}
	if (code === "same_password") {
		return "New password cannot be the same as the old one.";
	}

	return raw ?? "Sign-in failed. Please try again.";
}

export const MAX_PASSWORD_LEN = 24;
export const MIN_PASSWORD_LEN = 6;
export const CHANGE_PASSWORD_SAME_AS_OLD = "new password cannot be same as old";

/** Live typing: cap password length. */
export function sanitizePasswordInput(raw: string): string {
	return raw.slice(0, MAX_PASSWORD_LEN);
}

export function validatePassword(raw: string): string | null {
	const password = sanitizePasswordInput(raw);
	if (password.length < MIN_PASSWORD_LEN) {
		return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
	}
	if (password.length > MAX_PASSWORD_LEN) {
		return `Password must be at most ${MAX_PASSWORD_LEN} characters.`;
	}
	return null;
}

/** Human-readable message for Supabase data API errors. */
export function formatDbError(error: unknown): string {
	const code =
		error && typeof error === "object" && "code" in error
			? String(error.code)
			: "";
	const raw =
		error && typeof error === "object" && "message" in error
			? String(error.message)
			: typeof error === "string"
				? error
				: null;
	const lower = raw?.toLowerCase() ?? "";

	if (
		code === "23503" ||
		lower.includes("templates_user_id_fkey") ||
		lower.includes("violates foreign key constraint")
	) {
		return "Your session is no longer valid (account may have been removed). Sign out and sign in again.";
	}
	if (code === "42501" || lower.includes("row-level security")) {
		return "Not signed in or session expired. Sign in again.";
	}

	return raw ?? "Could not save. Please try again.";
}

export function isMissingDeleteAccountRpc(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const code = "code" in error ? String(error.code) : "";
	const message =
		"message" in error && typeof error.message === "string"
			? error.message.toLowerCase()
			: "";
	return (
		code === "PGRST202" ||
		message.includes("could not find the function") ||
		message.includes("delete_own_account")
	);
}

/** Account panel / deletion errors (separate from sign-in copy). */
export function formatAccountError(error: unknown): string {
	const raw =
		error && typeof error === "object"
			? ("message" in error && typeof error.message === "string"
					? error.message
					: null)
			: typeof error === "string"
				? error
				: null;
	const lower = raw?.toLowerCase() ?? "";

	if (lower.includes("not authenticated") || lower.includes("not signed in")) {
		return "Session expired. Sign in again, then retry.";
	}
	if (
		isMissingDeleteAccountRpc(error) ||
		lower.includes("function public.delete_own_account") ||
		lower.includes("schema cache") ||
		lower.includes("server missing supabase_service_role_key")
	) {
		return `Account deletion is not set up yet. Run the supabase/setup.sql in your new Supabase project.`;
	}
	if (lower.includes("your workout data was removed")) {
		return raw!;
	}
	if (
		lower.includes("username already taken") ||
		lower.includes("usernames_pkey") ||
		lower.includes("23505")
	) {
		return "This username is already taken.";
	}
	if (lower.includes("invalid username")) {
		return "Use 3–24 characters: letters, numbers, underscores, and hyphens.";
	}
	if (
		lower.includes("could not find the function") ||
		lower.includes("rename_username")
	) {
		return `Username rename is not set up yet. Run the supabase/setup.sql in your new Supabase project.`;
	}

	return raw ?? "Could not complete account action. Please try again.";
}

export function validateEmail(raw: string): string | null {
	const email = raw.trim();
	if (!email) return "Enter your email address.";
	if (email.length > 254) return "Email address is too long.";
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return "Enter a valid email address.";
	}
	return null;
}

/** Supabase may return a user with no identities when sign-up email/username already exists. */
export function isDuplicateSignupResponse(user: User | null | undefined): boolean {
	if (!user) return false;
	return !user.identities || user.identities.length === 0;
}

function getEmailRedirectUrl(): string {
	if (typeof window === "undefined") return "";
	return `${window.location.origin}/auth/callback`;
}

/** RFC 2606 reserved domain — accepted by Supabase; never shown to users. */
const USERNAME_AUTH_EMAIL_DOMAIN = "example.com";
const USERNAME_AUTH_LOCAL_PREFIX = "tr_";  // tractatus prefix

/** Older builds used these; kept for sign-in only. */
const LEGACY_USERNAME_EMAIL_SUFFIXES = [
	"@users.tractatus.app",
	"@user.tractatus.app",
] as const;

export const MAX_USERNAME_LEN = 24;
export const MIN_USERNAME_LEN = 3;
const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

export function normalizeUsername(raw: string): string {
	return raw.trim().toLowerCase();
}

/** Live typing: lowercase, allowed chars only, max length. */
export function sanitizeUsernameInput(raw: string): string {
	return normalizeUsername(raw)
		.replace(/[^a-z0-9_-]/g, "")
		.slice(0, MAX_USERNAME_LEN);
}

export function validateUsername(raw: string): string | null {
	const username = sanitizeUsernameInput(raw);
	if (username.length < MIN_USERNAME_LEN) {
		return `Username must be at least ${MIN_USERNAME_LEN} characters.`;
	}
	if (username.length > MAX_USERNAME_LEN) {
		return `Username must be at most ${MAX_USERNAME_LEN} characters.`;
	}
	if (!USERNAME_PATTERN.test(username)) {
		return "Use only letters, numbers, underscores, and hyphens.";
	}
	return null;
}

/** Maps username → internal auth email (not shown in UI). */
export function usernameToAuthEmail(username: string): string {
	const normalized = normalizeUsername(username);
	return `${USERNAME_AUTH_LOCAL_PREFIX}${normalized}@${USERNAME_AUTH_EMAIL_DOMAIN}`;
}

function legacyUsernameAuthEmails(username: string): string[] {
	const normalized = normalizeUsername(username);
	return LEGACY_USERNAME_EMAIL_SUFFIXES.map((suffix) => `${normalized}${suffix}`);
}

function usernameFromInternalEmail(email: string): string | null {
	const at = email.indexOf("@");
	if (at < 1) return null;
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	if (domain === USERNAME_AUTH_EMAIL_DOMAIN && local.startsWith(USERNAME_AUTH_LOCAL_PREFIX)) {
		return local.slice(USERNAME_AUTH_LOCAL_PREFIX.length) || null;
	}
	for (const suffix of LEGACY_USERNAME_EMAIL_SUFFIXES) {
		if (email.endsWith(suffix)) {
			return email.slice(0, -suffix.length) || null;
		}
	}
	return null;
}

export function getAuthDisplayName(user: User | null | undefined): string {
	if (!user) return "—";
	const meta = user.user_metadata?.username;
	if (typeof meta === "string" && meta.length > 0) return meta;
	const email = user.email ?? "";
	const fromEmail = usernameFromInternalEmail(email);
	if (fromEmail) return fromEmail;
	return email || "—";
}

export function isUsernameAccount(user: User | null | undefined): boolean {
	if (!user) return false;
	if (typeof user.user_metadata?.username === "string") return true;
	return usernameFromInternalEmail(user.email ?? "") !== null;
}

/** Email/username accounts can update password; OAuth-only accounts cannot. */
export function canChangePassword(user: User | null | undefined): boolean {
	if (!user) return false;
	if (isUsernameAccount(user)) return true;
	const identities = user.identities ?? [];
	if (identities.some((identity) => identity.provider === "email")) {
		return true;
	}
	const provider = user.app_metadata?.provider;
	return provider === "email";
}

/** Read OAuth error params Supabase appends to the redirect URL. */
export function getAuthRedirectError(): string | null {
	if (typeof window === "undefined") return null;

	const url = new URL(window.location.href);
	const description = url.searchParams.get("error_description");
	const code = url.searchParams.get("error");
	if (!description && !code) return null;

	if (description?.toLowerCase().includes("provider is not enabled")) {
		return formatAuthError({ msg: description });
	}

	return description ?? code;
}

function clearAuthRedirectParams(): void {
	if (typeof window === "undefined") return;

	const url = new URL(window.location.href);
	const hadAuthParams =
		url.searchParams.has("error") ||
		url.searchParams.has("error_description") ||
		url.searchParams.has("code") ||
		url.searchParams.has("state");

	if (!hadAuthParams) return;

	for (const key of [
		"error",
		"error_description",
		"code",
		"state",
		"token_hash",
		"type",
	]) {
		url.searchParams.delete(key);
	}
	const clean = `${url.pathname}${url.search}${url.hash}`;
	window.history.replaceState({}, "", clean || "/");
}

// ============================================================
// DB LAYER - AUTH FOCUSED (username + password + identicon)
// ============================================================

export const db = {
	/* ==================================================
		 AUTH
		 ================================================== */

	async signInWithGitHub() {
		const { error } = await supabase.auth.signInWithOAuth({
			provider: "github",
			options: { redirectTo: getOAuthRedirectUrl() },
		});
		if (error) throw error;
	},

	async signInWithGoogle() {
		const { error } = await supabase.auth.signInWithOAuth({
			provider: "google",
			options: { redirectTo: getOAuthRedirectUrl() },
		});
		if (error) throw error;
	},

	async signInWithDiscord() {
		const { error } = await supabase.auth.signInWithOAuth({
			provider: "discord",
			options: { redirectTo: getOAuthRedirectUrl() },
		});
		if (error) throw error;
	},

	async signInWithX() {
		const { error } = await supabase.auth.signInWithOAuth({
			provider: "twitter",
			options: { redirectTo: getOAuthRedirectUrl() },
		});
		if (error) throw error;
	},

	async isUsernameAvailable(username: string): Promise<boolean> {
		const validationError = validateUsername(username);
		if (validationError) return false;

		const { data, error } = await supabase.rpc("is_username_available", {
			p_username: normalizeUsername(username),
		});

		if (error) {
			if (
				error.code === "PGRST202" ||
				error.message?.toLowerCase().includes("could not find the function")
			) {
				return true;
			}
			throw error;
		}

		return data === true;
	},

	async registerUsername(username: string): Promise<void> {
		const normalized = normalizeUsername(username);
		const { error } = await supabase.rpc("register_username", {
			p_username: normalized,
		});
		if (error) throw error;
	},

	async renameUsername(newUsername: string): Promise<User> {
		const validationError = validateUsername(newUsername);
		if (validationError) throw new Error(validationError);

		const {
			data: { user: before },
			error: userErr,
		} = await supabase.auth.getUser();
		if (userErr) throw userErr;
		if (!before) throw new Error("Not signed in");
		if (!isUsernameAccount(before)) {
			throw new Error("Only username accounts can be renamed here.");
		}

		const normalized = normalizeUsername(newUsername);
		const current = normalizeUsername(getAuthDisplayName(before));
		if (normalized === current) return before;

		const { error } = await supabase.rpc("rename_username", {
			p_new_username: normalized,
		});
		if (error) throw error;

		const { error: refreshErr } = await supabase.auth.refreshSession();
		if (refreshErr) throw refreshErr;

		const {
			data: { user },
			error: afterErr,
		} = await supabase.auth.getUser();
		if (afterErr) throw afterErr;
		if (!user) throw new Error("Not signed in");
		return user;
	},

	async getAvatarSeed(): Promise<string | null> {
		const { data, error } = await supabase.rpc("get_avatar_seed");
		if (error) throw error;
		return data ?? null;
	},

	async saveAvatarSeed(seed: string | null): Promise<void> {
		const { error } = await supabase.rpc("save_avatar_seed", { p_seed: seed });
		if (error) throw error;
	},

	async signUpWithUsername(username: string, password: string) {
		const validationError = validateUsername(username);
		if (validationError) throw new Error(validationError);

		const passwordError = validatePassword(password);
		if (passwordError) throw new Error(passwordError);

		const normalized = normalizeUsername(username);

		const available = await this.isUsernameAvailable(normalized);
		if (!available) {
			throw Object.assign(new Error("User already registered"), {
				code: "user_already_exists",
			});
		}

		const { data, error } = await supabase.auth.signUp({
			email: usernameToAuthEmail(normalized),
			password,
			options: { data: { username: normalized } },
		});
		if (error) throw error;

		if (isDuplicateSignupResponse(data.user)) {
			throw Object.assign(new Error("User already registered"), {
				code: "user_already_exists",
			});
		}

		return data;
	},

	async signInWithUsername(username: string, password: string) {
		const validationError = validateUsername(username);
		if (validationError) throw new Error(validationError);

		const passwordError = validatePassword(password);
		if (passwordError) throw new Error(passwordError);

		const normalized = normalizeUsername(username);
		const primaryEmail = usernameToAuthEmail(normalized);
		const legacyEmails = legacyUsernameAuthEmails(normalized);

		const primary = await supabase.auth.signInWithPassword({
			email: primaryEmail,
			password,
		});
		if (!primary.error) return primary.data;

		const primaryCode =
			primary.error && typeof primary.error === "object" && "code" in primary.error
				? String(primary.error.code)
				: "";

		if (
			primaryCode &&
			primaryCode !== "invalid_credentials" &&
			primaryCode !== "user_not_found"
		) {
			throw primary.error;
		}

		if (legacyEmails.length === 0) {
			if (primaryCode === "invalid_credentials") {
				throw Object.assign(new Error("Invalid login credentials"), {
					code: "invalid_credentials",
				});
			}
			throw primary.error;
		}

		const legacyAttempts = await Promise.all(
			legacyEmails.map(async (email) => {
				const { data, error } = await supabase.auth.signInWithPassword({
					email,
					password,
				});
				return { data, error };
			}),
		);

		const legacySuccess = legacyAttempts.find((attempt) => !attempt.error);
		if (legacySuccess) return legacySuccess.data;

		const sawInvalidCredentials =
			primaryCode === "invalid_credentials" ||
			legacyAttempts.some(
				(attempt) =>
					attempt.error &&
					typeof attempt.error === "object" &&
					"code" in attempt.error &&
					attempt.error.code === "invalid_credentials",
			);

		if (sawInvalidCredentials) {
			throw Object.assign(new Error("Invalid login credentials"), {
				code: "invalid_credentials",
			});
		}

		throw primary.error ?? legacyAttempts[0]?.error ?? new Error("Sign in failed");
	},

	async signOut() {
		const { error } = await supabase.auth.signOut();
		if (error) throw error;
	},

	async getCurrentUser(): Promise<User | null> {
		const {
			data: { user },
		} = await supabase.auth.getUser();
		return user;
	},
};

// Basic type for future blog use
export interface UserProfile {
	username: string;
	avatar_seed?: string | null;
}