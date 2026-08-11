"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import "./GameCard.css";
import {Lock,Calendar,Star,Clock,MapPin,Users,Trophy,CheckCircle2,Timer,ChevronDown,Pencil,RefreshCw,TriangleAlert,Undo2,CircleCheck,CircleX,CircleCheckBig, UserPlus,History,} from "lucide-react";
import { filledCount } from "@/utils/playerCount";

interface GameCardProps {
  game: any;
  variant?: "upcoming" | "past";
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onPlayers: () => void;
  onComplete: () => void;
  onEdit?: () => void;
  onConfirm?: () => void;
  onWithdraw?: () => void;
  onCancel?: () => void;
  onSOS?: () => void;
  onSwitch?: () => void;
  onInvite?: () => void;
  onManageCoOrgs?: () => void;
  onTeamHistory?: () => void;
}

const getStatusConfig = (status: string) => {
  switch (status?.toLowerCase()) {
    case "confirmed":
      return {
        icon: <CheckCircle2 size={42} />,
        label: "CONFIRMED",
        className: "confirmed",
      };

    case "starting soon":
    case "tentative":
      return {
        icon: <Timer size={42} />,
        label: "STARTING SOON",
        className: "starting-soon",
      };

    case "completed":
      return {
        icon: <CheckCircle2 size={42} />,
        label: "COMPLETED",
        className: "completed",
      };

    case "cancelled":
      return {
        icon: <CircleX size={42} />,
        label: "CANCELLED",
        className: "cancelled",
      };

    default:
      return {
        icon: <Trophy size={42} />,
        label: "OPEN",
        className: "open",
      };
  }
};

const KNOWN_FORMATS = ["5v5", "6v6", "7v7", "8v8", "9v9", "11v11"];

const getFormatClass = (format: string) => {
  const key = (format || "").toLowerCase().replace(/\s+/g, "");
  return KNOWN_FORMATS.includes(key) ? `format-${key}` : "format-default";
};

const formatTime = (d: Date) =>
  d
    .toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    })
    .toUpperCase();

function GameCard({game,variant = "upcoming",isMenuOpen,onToggleMenu,onPlayers,onEdit,onConfirm,onWithdraw,onCancel,onSwitch,onSOS,onComplete,onInvite,onManageCoOrgs,onTeamHistory,
}: GameCardProps) {
  const status = getStatusConfig(game.status);
  const isPast = variant === "past";

  // Caller's role on this game. Missing → treat as owner (own games / legacy).
  const role: "owner" | "edit" | "view" = game.myRole || "owner";
  const isOwner = role === "owner";
  // Edit co-organisers have the same powers as the owner — cancelling the game and
  // managing its co-organisers included. Only the badge distinguishes them.
  const canEditGame = role === "owner" || role === "edit";
  const isViewer = role === "view";
  const presentCount =game.registrations?.filter((r: any) => r.attended === "present").length || 0; 

  const isPrivate = game.visibility === "private";

  // Actionable join requests awaiting the organiser's decision (public & private).
  const pendingCount = (game.invitations || []).filter((i: any) => i.status === "pending").length;
  // Approved-but-unpaid requests aren't actionable yet (waiting on the player's top-up)
  // but must stay reachable so they never vanish — they count toward showing the entry.
  const liveRequestCount = (game.invitations || []).filter((i: any) => ["pending", "approved_unpaid"].includes(i.status)).length;
  // Teams were announced at least once. `teamsPublished` flips back to false on
  // a reshuffle, but what was already sent out stays worth reading — so the
  // published-sheet reference, which survives a reshuffle, is what gates this.
  const hasTeamHistory = Boolean(game.publishedTeamSheet);

  const isClosed = ["completed", "cancelled"].includes(game.status);
  // Show the invite/requests entry when it's a private game (invite + manage link)
  // or whenever there are live requests to act on / follow up.
  const showInvite = (isPrivate || liveRequestCount > 0) && !isClosed;

  const gDay = new Date(game.scheduledAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata"});
  const fmt = (value: string | Date) => {
    const dt = new Date(value);

    const time = dt.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
    });

    return dt.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
    }) === gDay
      ? time
      : `${dt.toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
        })}, ${time}`;
  };

  const venue = [game.turf?.name, game.turf?.address?.city]
    .filter(Boolean)
    .join(", ");

  const scheduledDate = game.scheduledAt ? new Date(game.scheduledAt) : null;
  const date = scheduledDate
    ? `${scheduledDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} • ${formatTime(scheduledDate)}`
    : "";

  const reportTime =
    scheduledDate && game.reportingMinsBeforeGame > 0
      ? formatTime(
          new Date(
            scheduledDate.getTime() - game.reportingMinsBeforeGame * 60000,
          ),
        )
      : null;

  const endTime = game.endsAt ? formatTime(new Date(game.endsAt)) : null;

  const fee = game.feeInPaise ? game.feeInPaise / 100 : 0;
  const maxPlayers = game.totalSlots;
  const players = filledCount(game);
  const type = game.allowSizeChange ? "Flexible" : "Fixed";

  const dropdownRef = useRef<HTMLDivElement>(null);
  const [openUpward, setOpenUpward] = useState(false);

  useLayoutEffect(() => {
    if (!isMenuOpen) {
      setOpenUpward(false);
      return;
    }
    const el = dropdownRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setOpenUpward(rect.bottom > window.innerHeight);
  }, [isMenuOpen]);

  return (
    <div className={`game-card ${status.className}`}>
      <div className={`status-bar ${status.className}`} />

      <div className="game-left">
        <div className={`status-box ${status.className}`}>
          {status.icon}
          <div className="status-pill">{status.label}</div>
        </div>

        <div className="game-details">
          <div className="title-row">
            <h3>{game.title} </h3>
            {isPrivate && <Lock size={17} />}
            {!isOwner && (
              <span
                className={`co-org-badge ${role}`}
                title={
                  isViewer
                    ? "You are a co-organiser with view (read-only) access"
                    : "You are a co-organiser with edit access — full control of this game"
                }
              >
                Co-organiser · {isViewer ? "View" : "Edit"}
              </span>
            )}
          </div>

          <div className="detail-row">
            <MapPin size={15} />
            <span>{venue}</span>
          </div>

          <div className="detail-row">
            <Calendar size={15} />
            <span>{date}</span>
          </div>

          {reportTime && !isPast && (
            <div className="detail-row">
              <Clock size={15} />
              <span>
                Report {reportTime}
                {endTime ? ` • Ends ${endTime}` : ""}
              </span>
            </div>
          )}

          {!isPast &&
            (game.lifecycle?.firstCheckAt || game.lifecycle?.secondCheckAt) && (
              <div
                className="detail-row"
                title="Automatic confirmation check-in times"
              >
                <CircleCheckBig size={15} />
                <span>
                  1st{" "}
                  {game.lifecycle?.firstCheckAt &&
                    fmt(game.lifecycle.firstCheckAt)}
                  {game.lifecycle?.secondCheckAt &&
                    ` • 2nd ${fmt(game.lifecycle.secondCheckAt)}`}
                </span>
              </div>
            )}
        </div>
      </div>

      <div className="game-stats">
        <div className="stat">
          <span>FORMAT</span>

          <div className={`badge ${getFormatClass(game.format)}`}>
            {game.format}
          </div>

          <small>{type}</small>
        </div>

        <div className="stat">
          <span>FEE</span>

          <strong>₹{fee}</strong>
        </div>

        <div className="stat">
          <span>PLAYERS</span>

          <strong className="players">
            <Users size={16} />
            {players}/{maxPlayers}
          </strong>
        </div>

        {isPast && (
          <div className="stat stat-postgame">
            <span>RESULT</span>

            {game.status === "completed" ? (
              <div className="postgame-mini">
                <div className="postgame-mini-row">
                  <span>Present</span>
                  <b>{presentCount}</b>
                </div>
                <div className="postgame-mini-row">
                  <span>Ratings</span>
                  {/* Against the number who turned up — the count alone never said
                      whether the rating pass was finished. */}
                  <b>
                    {game.playerRatingsCount || 0}
                    {presentCount > 0 && <span style={{ opacity: 0.4 }}>/{presentCount}</span>}
                  </b>
                </div>
                <div className="postgame-mini-row">
                  <span>Feedback</span>
                  <b>{game.feedbackCount || 0}</b>
                </div>
              </div>
            ) : game.status === "cancelled" ? (
              <small className="postgame-mini-status cancelled">
                Cancelled
              </small>
            ) : (
              <small className="postgame-mini-status pending">Pending</small>
            )}
          </div>
        )}
      </div>

      <div className="game-actions">
        <button
          className={`action-btn ${isMenuOpen ? "active" : ""}`}
          onClick={onToggleMenu}
        >
          Actions
          <ChevronDown size={16} className={isMenuOpen ? "rotate-icon" : ""} />
        </button>

        {isMenuOpen && (
          <div
            ref={dropdownRef}
            className={`actions-dropdown ${openUpward ? "dropdown-up" : ""}`}
          >
            <button
              onClick={onPlayers}
              title="View Players"
              className="view-players"
            >
              <Users size={16} />
              Players
            </button>

            {/* Read-only, so co-organisers with view access get it too */}
            {hasTeamHistory && onTeamHistory && (
              <button
                onClick={onTeamHistory}
                title="What the players were told, and when"
                className="team-history-item"
              >
                <History size={16} />
                Team history
              </button>
            )}

            {isPast ? (
              <>
                {canEditGame && !["completed", "cancelled"].includes(game.status) && (
                  <button
                    onClick={onComplete}
                    className="complete-event"
                    title="Complete Game & Rate Players"
                  >
                    <CircleCheck size={16} />
                    Complete
                  </button>
                )}

                {canEditGame && game.status === "completed" && !game.attendanceMarked && (
                  <button onClick={onComplete}>
                    <CircleCheck size={16} />
                    Mark Attendance
                  </button>
                )}

                {game.status === "completed" && game.attendanceMarked && (
                  <button
                    onClick={onComplete}
                    title="View/Edit Ratings"
                    className="ratings"
                  >
                    <Star size={16} />
                    Ratings
                  </button>
                )}
              </>
            ) : (
              <>
                {canEditGame && onEdit && (
                  <button
                    onClick={onEdit}
                    title="Edit Event"
                    className="edit-item"
                  >
                    <Pencil size={16} />
                    Edit Event
                  </button>
                )}

                {canEditGame && showInvite &&
                      <>
                      <button
                        className="invite-item"
                        onClick={onInvite}
                        title={isPrivate ? "Invite players & manage requests" : "Review join requests"}
                        style={{ position: "relative" }}
                      >
                      <UserPlus size={16} />
                      {isPrivate ? "Invite" : "Requests"}{pendingCount > 0 && <span>{pendingCount}</span>}
                      </button>
                      </>
                 }

                {canEditGame && ["open", "tentative"].includes(game.status) && onConfirm && (
                  <button
                    className="confirm-item"
                    onClick={onConfirm}
                    title="Confirm Game"
                  >
                    <CheckCircle2 size={16} />
                    Confirm
                  </button>
                )}

                {canEditGame &&
                  ["open", "tentative", "confirmed"].includes(game.status) &&
                  game.alternateFormats?.length > 0 &&
                  !game.lifecycle?.switchedAt &&
                  onSwitch && (
                    <button onClick={onSwitch}>
                      <RefreshCw size={16} />
                      Switch Format
                    </button>
                  )}

                {canEditGame &&
                  ["open", "tentative", "confirmed"].includes(game.status) &&
                  onSOS && (
                    <button
                      className="sos-item"
                      onClick={onSOS}
                      title="Send SOS to venue regulars"
                    >
                      <TriangleAlert size={16} />
                      SOS
                    </button>
                  )}

                {canEditGame && game.organiserIsPlaying && onWithdraw && (
                  <button
                    className="withdraw-item"
                    onClick={onWithdraw}
                    title="Withdraw from game"
                  >
                    <Undo2 size={16} />
                    Withdraw
                  </button>
                )}

                {canEditGame &&
                  !["cancelled", "completed"].includes(game.status) &&
                  new Date(game.scheduledAt) <= new Date() && (
                    <button onClick={onComplete}>
                      <CircleCheck size={16} />
                      Complete
                    </button>
                  )}

                {/* Co-organiser management — owner and edit co-organisers */}
                {canEditGame && onManageCoOrgs && (
                  <button
                    className="co-org-item"
                    onClick={onManageCoOrgs}
                    title="Manage co-organisers"
                  >
                    <UserPlus size={16} />
                    Co-organisers
                    {game.coOrganisers?.length > 0 && <span>{game.coOrganisers.length}</span>}
                  </button>
                )}

                {canEditGame && onCancel && (
                  <button
                    className="danger-item"
                    onClick={onCancel}
                    title="Cancel Game"
                  >
                    <CircleX size={16} />
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default GameCard;
