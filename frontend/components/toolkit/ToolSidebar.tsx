"use client";
import { useState, useMemo } from "react";
import {
  TOOLS,
  CATEGORIES,
  CATEGORY_LABELS,
  searchTools,
  ToolDefinition,
} from "./lib/toolRegistry";
import { IconSearch, IconChevronDown, IconStar } from "@/components/icons";

export interface ToolSidebarProps {
  selectedToolId: string;
  onSelectTool: (toolId: string) => void;
  favorites?: string[];
  onToggleFavorite?: (toolId: string) => void;
}

export default function ToolSidebar({
  selectedToolId,
  onSelectTool,
  favorites = [],
  onToggleFavorite,
}: ToolSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(CATEGORIES),
  );

  const filteredTools = useMemo(() => {
    if (!searchQuery) return TOOLS;
    return searchTools(searchQuery);
  }, [searchQuery]);

  const groupedTools = useMemo(() => {
    const groups: Record<string, ToolDefinition[]> = {};
    for (const category of CATEGORIES) {
      groups[category] = filteredTools.filter((t) => t.category === category);
    }
    return groups;
  }, [filteredTools]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const isFavorite = (toolId: string) => favorites.includes(toolId);

  return (
    <div
      className="flex flex-col gap-3 overflow-hidden rounded-lg shrink-0"
      style={{
        borderColor: "var(--border)",
        background: "var(--surface)",
        width: "280px",
      }}
    >
      {/* Search */}
      <div
        className="shrink-0 border-b p-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="relative">
          <IconSearch
            width={16}
            height={16}
            style={{
              position: "absolute",
              left: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
            }}
          />
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border bg-transparent pl-9 pr-3 py-2 text-sm outline-none"
            style={{
              borderColor: "var(--border)",
              color: "var(--text)",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "var(--accent)")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = "var(--border)")
            }
          />
        </div>
      </div>

      {/* Tools List */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <div className="space-y-1">
          {searchQuery
            ? // Search results (flat list)
              filteredTools.map((tool) => (
                <ToolItem
                  key={tool.id}
                  tool={tool}
                  isSelected={selectedToolId === tool.id}
                  isFavorite={isFavorite(tool.id)}
                  onSelect={() => onSelectTool(tool.id)}
                  onToggleFavorite={() => onToggleFavorite?.(tool.id)}
                />
              ))
            : // Grouped by category
              CATEGORIES.map((category) => {
                const categoryTools = groupedTools[category];
                if (categoryTools.length === 0) return null;

                const isExpanded = expandedCategories.has(category);
                return (
                  <div key={category}>
                    <button
                      onClick={() => toggleCategory(category)}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors"
                      style={{
                        color: "var(--text-muted)",
                        textAlign: "left",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = "var(--surface-2)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "")
                      }
                    >
                      <IconChevronDown
                        width={14}
                        height={14}
                        style={{
                          transform: isExpanded
                            ? "rotate(0deg)"
                            : "rotate(-90deg)",
                          transition: "transform 0.2s",
                        }}
                      />
                      <span className="text-xs font-semibold uppercase tracking-wide">
                        {CATEGORY_LABELS[category]}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="space-y-1 pl-2">
                        {categoryTools.map((tool) => (
                          <ToolItem
                            key={tool.id}
                            tool={tool}
                            isSelected={selectedToolId === tool.id}
                            isFavorite={isFavorite(tool.id)}
                            onSelect={() => onSelectTool(tool.id)}
                            onToggleFavorite={() => onToggleFavorite?.(tool.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}

function ToolItem({
  tool,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: {
  tool: ToolDefinition;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="group relative w-full rounded px-3 py-2 text-left text-sm transition-colors"
      style={{
        background: isSelected ? "var(--accent-soft)" : undefined,
        color: isSelected ? "var(--accent)" : "var(--text)",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "";
      }}
      title={tool.description}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-tight">{tool.name}</div>
          <div
            className="truncate text-xs"
            style={{
              color: isSelected ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {tool.description}
          </div>
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onToggleFavorite();
            }
          }}
          className="shrink-0 text-lg leading-none opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer"
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <IconStar width={14} height={14}
            fill={isFavorite ? "var(--warning)" : "none"}
            style={{ color: isFavorite ? "var(--warning)" : "var(--text-faint)" }} />
        </div>
      </div>
    </button>
  );
}
