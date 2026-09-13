export type EmailStatus = "scheduled" | "deferred" | "sending" | "sent" | "failed";
export interface Email { id: string; recipient: string; sender: string; subject: string; scheduledAt: string; sentAt: string | null; status: EmailStatus; error?: string | null }
export interface User { id: string; email: string; name: string; avatarUrl: string | null }
