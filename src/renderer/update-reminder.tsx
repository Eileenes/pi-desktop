import { memo, useEffect, useState } from "react";
import type { DesktopUpdateInfo } from "../shared/contracts.ts";
import { checkForUpdates, openExternalUrl } from "./desktop-store.ts";
import { useI18n } from "./i18n.ts";

const SNOOZE_KEY = "pi-desktop-update-snooze";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function isSnoozed(signature: string): boolean {
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "null");
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
		const record = raw as { until?: unknown; signature?: unknown };
		if (typeof record.until !== "number" || typeof record.signature !== "string") return false;
		return record.signature === signature && Date.now() < record.until;
	} catch {
		return false;
	}
}

export const UpdateReminder = memo(function UpdateReminder({ onOpenSettings }: { onOpenSettings: () => void }) {
	const { t } = useI18n();
	const [update, setUpdate] = useState<DesktopUpdateInfo>();
	const [dismissed, setDismissed] = useState(false);

	useEffect(() => {
		let active = true;
		void checkForUpdates()
			.then((value) => {
				if (active) setUpdate(value);
			})
			.catch(() => {
				if (active) setUpdate(undefined);
			});
		return () => {
			active = false;
		};
	}, []);

	if (dismissed || !update?.updateAvailable || !update.latestVersion) return null;
	const signature = `${update.currentVersion}->${update.latestVersion}`;
	if (isSnoozed(signature)) return null;

	return (
		<aside className="update-reminder" aria-label={t("appUpdate")}>
			<strong>{t("newVersionAvailable")}</strong>
			<p>{t("updateAvailableDetail", { current: update.currentVersion, latest: update.latestVersion })}</p>
			<div className="update-reminder-actions">
				<button className="quiet-button" type="button" onClick={onOpenSettings}>
					{t("openSettings")}
				</button>
				<button className="outline-button" type="button" onClick={() => void openExternalUrl(update.releaseUrl)}>
					{t("viewRelease")}
				</button>
				<button
					className="quiet-button"
					type="button"
					onClick={() => {
						localStorage.setItem(SNOOZE_KEY, JSON.stringify({ until: Date.now() + SNOOZE_MS, signature }));
						setDismissed(true);
					}}
				>
					{t("remindLater")}
				</button>
			</div>
		</aside>
	);
});
