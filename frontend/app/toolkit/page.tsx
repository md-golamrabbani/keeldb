"use client";
import { Suspense, useMemo, useEffect, useState } from "react";
import ToolSidebar from "@/components/toolkit/ToolSidebar";
import { useToolkitStore } from "@/lib/toolkitStore";
import { getToolById } from "@/components/toolkit/lib/toolRegistry";

// Import all tools
import SqlInClauseTool from "@/components/toolkit/tools/SqlInClauseTool";
import QuoteUnquoteTool from "@/components/toolkit/tools/QuoteUnquoteTool";
import BulkInsertTool from "@/components/toolkit/tools/BulkInsertTool";
import BulkUpdateTool from "@/components/toolkit/tools/BulkUpdateTool";
import BulkWhereTool from "@/components/toolkit/tools/BulkWhereTool";
import DataNormalizerTool from "@/components/toolkit/tools/DataNormalizerTool";
import DateTimestampTool from "@/components/toolkit/tools/DateTimestampTool";
import CsvToSqlTool from "@/components/toolkit/tools/CsvToSqlTool";
import JsonToSqlTool from "@/components/toolkit/tools/JsonToSqlTool";
import ListCompareTool from "@/components/toolkit/tools/ListCompareTool";
import DeduplicateTool from "@/components/toolkit/tools/DeduplicateTool";
import RangeExpanderTool from "@/components/toolkit/tools/RangeExpanderTool";
import CteValuesBuilderTool from "@/components/toolkit/tools/CteValuesBuilderTool";
import SqlEscapingTool from "@/components/toolkit/tools/SqlEscapingTool";
import ColumnMapperTool from "@/components/toolkit/tools/ColumnMapperTool";
import QuerySnippetsTool from "@/components/toolkit/tools/QuerySnippetsTool";
import IdValidatorTool from "@/components/toolkit/tools/IdValidatorTool";
import CaseBuilderTool from "@/components/toolkit/tools/CaseBuilderTool";
import CopyPasteCleanupTool from "@/components/toolkit/tools/CopyPasteCleanupTool";
import MultiFormatConverterTool from "@/components/toolkit/tools/MultiFormatConverterTool";
import HashEncodingTool from "@/components/toolkit/tools/HashEncodingTool";
import JwtInspectorTool from "@/components/toolkit/tools/JwtInspectorTool";
import SqlPlaceholdersTool from "@/components/toolkit/tools/SqlPlaceholdersTool";
import SampleDataTool from "@/components/toolkit/tools/SampleDataTool";
import TextCaseConverterTool from "@/components/toolkit/tools/TextCaseConverterTool";

const TOOL_COMPONENTS: Record<string, React.ComponentType> = {
  "sql-in-clause": SqlInClauseTool,
  "quote-unquote": QuoteUnquoteTool,
  "bulk-insert": BulkInsertTool,
  "bulk-update": BulkUpdateTool,
  "bulk-where": BulkWhereTool,
  "data-normalizer": DataNormalizerTool,
  "date-timestamp": DateTimestampTool,
  "csv-to-sql": CsvToSqlTool,
  "json-to-sql": JsonToSqlTool,
  "list-compare": ListCompareTool,
  deduplicate: DeduplicateTool,
  "range-expander": RangeExpanderTool,
  "cte-values-builder": CteValuesBuilderTool,
  "sql-escaping": SqlEscapingTool,
  "column-mapper": ColumnMapperTool,
  "query-snippets": QuerySnippetsTool,
  "id-validator": IdValidatorTool,
  "case-builder": CaseBuilderTool,
  "copy-paste-cleanup": CopyPasteCleanupTool,
  "multi-format-converter": MultiFormatConverterTool,
  "hash-encoding": HashEncodingTool,
  "jwt-inspector": JwtInspectorTool,
  "sql-placeholder": SqlPlaceholdersTool,
  "sample-data": SampleDataTool,
  "text-case-converter": TextCaseConverterTool,
};

function ToolkitContent() {
  const selectedToolId = useToolkitStore((s) => s.selectedToolId);
  const setSelectedTool = useToolkitStore((s) => s.setSelectedTool);
  const favorites = useToolkitStore((s) => s.favorites);
  const toggleFavorite = useToolkitStore((s) => s.toggleFavorite);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const SelectedToolComponent = useMemo(() => {
    return TOOL_COMPONENTS[selectedToolId] || SqlInClauseTool;
  }, [selectedToolId]);

  if (!mounted) {
    return <p className="text-center py-12 muted">Loading toolkit...</p>;
  }

  return (
    <div className="flex gap-1 h-full overflow-hidden">
      <ToolSidebar
        selectedToolId={selectedToolId}
        onSelectTool={setSelectedTool}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
      />
      <div className="flex-1 overflow-y-auto px-6">
        <Suspense
          fallback={<p className="text-center py-12 muted">Loading tool...</p>}
        >
          <SelectedToolComponent />
        </Suspense>
      </div>
    </div>
  );
}

export default function ToolkitPage() {
  return (
    <div style={{ height: "calc(100vh - 120px)" }}>
      <ToolkitContent />
    </div>
  );
}
