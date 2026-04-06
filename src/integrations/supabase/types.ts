export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      capstone_exam_answers: {
        Row: {
          answered_at: string
          exam_id: string
          id: string
          is_correct: boolean
          question_id: string
          user_answer: string | null
        }
        Insert: {
          answered_at?: string
          exam_id: string
          id?: string
          is_correct?: boolean
          question_id: string
          user_answer?: string | null
        }
        Update: {
          answered_at?: string
          exam_id?: string
          id?: string
          is_correct?: boolean
          question_id?: string
          user_answer?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "capstone_exam_answers_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "capstone_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capstone_exam_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "capstone_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      capstone_exams: {
        Row: {
          completed_at: string | null
          correct_answers: number
          created_at: string
          id: string
          status: string
          time_limit_seconds: number | null
          time_taken_seconds: number | null
          title: string
          topic_breakdown: Json | null
          total_questions: number
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          correct_answers?: number
          created_at?: string
          id?: string
          status?: string
          time_limit_seconds?: number | null
          time_taken_seconds?: number | null
          title?: string
          topic_breakdown?: Json | null
          total_questions?: number
          user_id: string
        }
        Update: {
          completed_at?: string | null
          correct_answers?: number
          created_at?: string
          id?: string
          status?: string
          time_limit_seconds?: number | null
          time_taken_seconds?: number | null
          title?: string
          topic_breakdown?: Json | null
          total_questions?: number
          user_id?: string
        }
        Relationships: []
      }
      capstone_questions: {
        Row: {
          clause_reference: string | null
          correct_answer: string
          created_at: string
          difficulty: string
          explanation: string | null
          id: string
          options: Json
          question: string
          standard_id: string | null
          topic: string | null
          user_id: string
        }
        Insert: {
          clause_reference?: string | null
          correct_answer: string
          created_at?: string
          difficulty?: string
          explanation?: string | null
          id?: string
          options?: Json
          question: string
          standard_id?: string | null
          topic?: string | null
          user_id: string
        }
        Update: {
          clause_reference?: string | null
          correct_answer?: string
          created_at?: string
          difficulty?: string
          explanation?: string | null
          id?: string
          options?: Json
          question?: string
          standard_id?: string | null
          topic?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capstone_questions_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      capstone_study_guides: {
        Row: {
          content: string
          created_at: string
          id: string
          standard_id: string | null
          title: string
          topics: Json | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          standard_id?: string | null
          title: string
          topics?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          standard_id?: string | null
          title?: string
          topics?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capstone_study_guides_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      citations: {
        Row: {
          chunk_content: string | null
          clause_number: string | null
          confidence_score: number | null
          id: string
          page_number: number | null
          query_id: string
          standard_code: string | null
          standard_id: string
          version: string | null
        }
        Insert: {
          chunk_content?: string | null
          clause_number?: string | null
          confidence_score?: number | null
          id?: string
          page_number?: number | null
          query_id: string
          standard_code?: string | null
          standard_id: string
          version?: string | null
        }
        Update: {
          chunk_content?: string | null
          clause_number?: string | null
          confidence_score?: number | null
          id?: string
          page_number?: number | null
          query_id?: string
          standard_code?: string | null
          standard_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "citations_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      processing_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          standard_id: string
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          standard_id: string
          started_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          standard_id?: string
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          daily_query_count: number
          daily_query_reset_at: string
          display_name: string | null
          email: string | null
          id: string
          subscription_tier: Database["public"]["Enums"]["subscription_tier"]
          trade_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_query_count?: number
          daily_query_reset_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          trade_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_query_count?: number
          daily_query_reset_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          trade_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      queries: {
        Row: {
          citations: Json | null
          confidence_score: number | null
          created_at: string
          id: string
          image_url: string | null
          question: string
          response: string | null
          safety_flagged: boolean
          subscription_tier_at_time:
            | Database["public"]["Enums"]["subscription_tier"]
            | null
          user_id: string
        }
        Insert: {
          citations?: Json | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          question: string
          response?: string | null
          safety_flagged?: boolean
          subscription_tier_at_time?:
            | Database["public"]["Enums"]["subscription_tier"]
            | null
          user_id: string
        }
        Update: {
          citations?: Json | null
          confidence_score?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          question?: string
          response?: string | null
          safety_flagged?: boolean
          subscription_tier_at_time?:
            | Database["public"]["Enums"]["subscription_tier"]
            | null
          user_id?: string
        }
        Relationships: []
      }
      standard_chunks: {
        Row: {
          chunk_index: number
          clause_number: string | null
          clause_title: string | null
          content: string
          created_at: string
          embedding: string | null
          id: string
          is_indexed: boolean
          page_number: number | null
          standard_id: string
          user_id: string
        }
        Insert: {
          chunk_index: number
          clause_number?: string | null
          clause_title?: string | null
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          is_indexed?: boolean
          page_number?: number | null
          standard_id: string
          user_id: string
        }
        Update: {
          chunk_index?: number
          clause_number?: string | null
          clause_title?: string | null
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          is_indexed?: boolean
          page_number?: number | null
          standard_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "standard_chunks_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      standards: {
        Row: {
          created_at: string
          extraction_quality_score: number | null
          extraction_status: Database["public"]["Enums"]["extraction_status"]
          file_path: string | null
          file_url: string | null
          id: string
          indexed_chunks: number | null
          is_partial: boolean
          standard_code: string | null
          title: string
          total_chunks: number | null
          trade_category: string | null
          updated_at: string
          user_id: string
          version: string | null
        }
        Insert: {
          created_at?: string
          extraction_quality_score?: number | null
          extraction_status?: Database["public"]["Enums"]["extraction_status"]
          file_path?: string | null
          file_url?: string | null
          id?: string
          indexed_chunks?: number | null
          is_partial?: boolean
          standard_code?: string | null
          title: string
          total_chunks?: number | null
          trade_category?: string | null
          updated_at?: string
          user_id: string
          version?: string | null
        }
        Update: {
          created_at?: string
          extraction_quality_score?: number | null
          extraction_status?: Database["public"]["Enums"]["extraction_status"]
          file_path?: string | null
          file_url?: string | null
          id?: string
          indexed_chunks?: number | null
          is_partial?: boolean
          standard_code?: string | null
          title?: string
          total_chunks?: number | null
          trade_category?: string | null
          updated_at?: string
          user_id?: string
          version?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_chunks: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          clause_number: string
          clause_title: string
          content: string
          id: string
          page_number: number
          similarity: number
          standard_id: string
        }[]
      }
    }
    Enums: {
      extraction_status: "pending" | "processing" | "complete" | "failed"
      subscription_tier: "free" | "pro" | "business"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      extraction_status: ["pending", "processing", "complete", "failed"],
      subscription_tier: ["free", "pro", "business"],
    },
  },
} as const
