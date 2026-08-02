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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          created_at: string
          id: string
          kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      audit_photos: {
        Row: {
          assessments: Json
          audit_id: string
          citations: Json
          created_at: string
          id: string
          label: string | null
          needs_to_know: Json
          severity: string | null
          status: string
          storage_path: string
          updated_at: string
          user_id: string
          user_notes: string | null
          what_i_see: string | null
        }
        Insert: {
          assessments?: Json
          audit_id: string
          citations?: Json
          created_at?: string
          id?: string
          label?: string | null
          needs_to_know?: Json
          severity?: string | null
          status?: string
          storage_path: string
          updated_at?: string
          user_id: string
          user_notes?: string | null
          what_i_see?: string | null
        }
        Update: {
          assessments?: Json
          audit_id?: string
          citations?: Json
          created_at?: string
          id?: string
          label?: string | null
          needs_to_know?: Json
          severity?: string | null
          status?: string
          storage_path?: string
          updated_at?: string
          user_id?: string
          user_notes?: string | null
          what_i_see?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_photos_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "audits"
            referencedColumns: ["id"]
          },
        ]
      }
      audits: {
        Row: {
          created_at: string
          id: string
          signed_off_at: string | null
          signed_off_by: string | null
          signed_off_licence: string | null
          site_address: string | null
          status: string
          title: string
          trade: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          signed_off_licence?: string | null
          site_address?: string | null
          status?: string
          title: string
          trade?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          signed_off_licence?: string | null
          site_address?: string | null
          status?: string
          title?: string
          trade?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      capstone_practice_questions: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          standard_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload: Json
          standard_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          standard_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capstone_practice_questions_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
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
      capstone_usage: {
        Row: {
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
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
      organization_members: {
        Row: {
          created_at: string
          id: string
          invited_email: string
          joined_at: string | null
          organization_id: string
          role: string
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invited_email: string
          joined_at?: string | null
          organization_id: string
          role?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invited_email?: string
          joined_at?: string | null
          organization_id?: string
          role?: string
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          seat_limit: number
          stripe_subscription_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_user_id: string
          seat_limit?: number
          stripe_subscription_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          seat_limit?: number
          stripe_subscription_id?: string | null
        }
        Relationships: []
      }
      processing_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          heartbeat_at: string | null
          id: string
          ocr_next_page: number | null
          ocr_text: string | null
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
          heartbeat_at?: string | null
          id?: string
          ocr_next_page?: number | null
          ocr_text?: string | null
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
          heartbeat_at?: string | null
          id?: string
          ocr_next_page?: number | null
          ocr_text?: string | null
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
          business_name: string | null
          created_at: string
          daily_query_count: number
          daily_query_reset_at: string
          display_name: string | null
          email: string | null
          id: string
          licence_number: string | null
          logo_storage_path: string | null
          pro_expires_at: string | null
          stripe_customer_id: string | null
          subscription_tier: Database["public"]["Enums"]["subscription_tier"]
          trade_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_name?: string | null
          created_at?: string
          daily_query_count?: number
          daily_query_reset_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          licence_number?: string | null
          logo_storage_path?: string | null
          pro_expires_at?: string | null
          stripe_customer_id?: string | null
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          trade_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_name?: string | null
          created_at?: string
          daily_query_count?: number
          daily_query_reset_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          licence_number?: string | null
          logo_storage_path?: string | null
          pro_expires_at?: string | null
          stripe_customer_id?: string | null
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
      query_feedback: {
        Row: {
          approved_for_training: boolean | null
          created_at: string | null
          id: string
          query_id: string
          question_embedding: string | null
          question_text: string | null
          rating: string
          reviewed: boolean | null
          reviewed_at: string | null
          reviewer_notes: string | null
          user_comment: string | null
          user_id: string | null
        }
        Insert: {
          approved_for_training?: boolean | null
          created_at?: string | null
          id?: string
          query_id: string
          question_embedding?: string | null
          question_text?: string | null
          rating: string
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewer_notes?: string | null
          user_comment?: string | null
          user_id?: string | null
        }
        Update: {
          approved_for_training?: boolean | null
          created_at?: string | null
          id?: string
          query_id?: string
          question_embedding?: string | null
          question_text?: string | null
          rating?: string
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewer_notes?: string | null
          user_comment?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "query_feedback_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "bad_responses_for_review"
            referencedColumns: ["query_id"]
          },
          {
            foreignKeyName: "query_feedback_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "query_log"
            referencedColumns: ["id"]
          },
        ]
      }
      query_log: {
        Row: {
          confidence_score: number | null
          created_at: string | null
          id: string
          model_used: string | null
          needs_review: boolean | null
          query_text: string
          response_text: string | null
          response_time_ms: number | null
          retrieved_chunk_count: number | null
          retrieved_chunk_ids: string[] | null
          standard_id: string | null
          trade: string | null
          user_id: string | null
          validation_issues: Json | null
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          model_used?: string | null
          needs_review?: boolean | null
          query_text: string
          response_text?: string | null
          response_time_ms?: number | null
          retrieved_chunk_count?: number | null
          retrieved_chunk_ids?: string[] | null
          standard_id?: string | null
          trade?: string | null
          user_id?: string | null
          validation_issues?: Json | null
        }
        Update: {
          confidence_score?: number | null
          created_at?: string | null
          id?: string
          model_used?: string | null
          needs_review?: boolean | null
          query_text?: string
          response_text?: string | null
          response_time_ms?: number | null
          retrieved_chunk_count?: number | null
          retrieved_chunk_ids?: string[] | null
          standard_id?: string | null
          trade?: string | null
          user_id?: string | null
          validation_issues?: Json | null
        }
        Relationships: []
      }
      question_cache: {
        Row: {
          created_at: string
          hit_count: number
          id: string
          last_used_at: string
          organization_id: string
          question: string
          question_embedding: string
          response: Json
          standard_id: string | null
        }
        Insert: {
          created_at?: string
          hit_count?: number
          id?: string
          last_used_at?: string
          organization_id: string
          question: string
          question_embedding: string
          response: Json
          standard_id?: string | null
        }
        Update: {
          created_at?: string
          hit_count?: number
          id?: string
          last_used_at?: string
          organization_id?: string
          question?: string
          question_embedding?: string
          response?: Json
          standard_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "question_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_cache_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_chunks: {
        Row: {
          chunk_index: number
          clause_number: string | null
          clause_title: string | null
          content: string
          context_generated: boolean
          created_at: string
          embedding: string | null
          fts: unknown
          id: string
          index_attempts: number
          is_indexed: boolean
          organization_id: string | null
          page_number: number | null
          standard_id: string
          user_id: string
        }
        Insert: {
          chunk_index: number
          clause_number?: string | null
          clause_title?: string | null
          content: string
          context_generated?: boolean
          created_at?: string
          embedding?: string | null
          fts?: unknown
          id?: string
          index_attempts?: number
          is_indexed?: boolean
          organization_id?: string | null
          page_number?: number | null
          standard_id: string
          user_id: string
        }
        Update: {
          chunk_index?: number
          clause_number?: string | null
          clause_title?: string | null
          content?: string
          context_generated?: boolean
          created_at?: string
          embedding?: string | null
          fts?: unknown
          id?: string
          index_attempts?: number
          is_indexed?: boolean
          organization_id?: string | null
          page_number?: number | null
          standard_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "standard_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standard_chunks_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_figures: {
        Row: {
          caption: string | null
          created_at: string | null
          figure_number: string
          id: string
          image_url: string
          organization_id: string | null
          page_number: number | null
          standard_id: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          figure_number: string
          id?: string
          image_url: string
          organization_id?: string | null
          page_number?: number | null
          standard_id: string
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          figure_number?: string
          id?: string
          image_url?: string
          organization_id?: string | null
          page_number?: number | null
          standard_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "standard_figures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standard_figures_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_tables: {
        Row: {
          caption: string | null
          created_at: string | null
          id: string
          image_url: string
          organization_id: string | null
          page_number: number | null
          standard_id: string
          table_number: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url: string
          organization_id?: string | null
          page_number?: number | null
          standard_id: string
          table_number: string
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          id?: string
          image_url?: string
          organization_id?: string | null
          page_number?: number | null
          standard_id?: string
          table_number?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "standard_tables_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standard_tables_standard_id_fkey"
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
          failed_chunks_count: number
          file_path: string | null
          file_url: string | null
          id: string
          indexed_chunks: number | null
          is_partial: boolean
          organization_id: string | null
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
          failed_chunks_count?: number
          file_path?: string | null
          file_url?: string | null
          id?: string
          indexed_chunks?: number | null
          is_partial?: boolean
          organization_id?: string | null
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
          failed_chunks_count?: number
          file_path?: string | null
          file_url?: string | null
          id?: string
          indexed_chunks?: number | null
          is_partial?: boolean
          organization_id?: string | null
          standard_code?: string | null
          title?: string
          total_chunks?: number | null
          trade_category?: string | null
          updated_at?: string
          user_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "standards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          quantity: number
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          quantity?: number
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          tier: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          quantity?: number
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trial_grants: {
        Row: {
          created_at: string
          days: number
          email: string
          granted_by: string
          id: string
          redeemed_at: string | null
          tier: Database["public"]["Enums"]["subscription_tier"]
        }
        Insert: {
          created_at?: string
          days: number
          email: string
          granted_by: string
          id?: string
          redeemed_at?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
        }
        Update: {
          created_at?: string
          days?: number
          email?: string
          granted_by?: string
          id?: string
          redeemed_at?: string | null
          tier?: Database["public"]["Enums"]["subscription_tier"]
        }
        Relationships: []
      }
      vision_batch_jobs: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          items: Json
          standard_id: string
          status: string
          user_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          items: Json
          standard_id: string
          status?: string
          user_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          items?: Json
          standard_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vision_batch_jobs_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bad_responses_for_review: {
        Row: {
          confidence_score: number | null
          feedback_at: string | null
          query_id: string | null
          query_text: string | null
          rating: string | null
          response_text: string | null
          reviewed: boolean | null
          trade: string | null
          user_comment: string | null
          validation_issues: Json | null
        }
        Relationships: []
      }
      weekly_accuracy_summary: {
        Row: {
          accuracy_percentage: number | null
          helpful_count: number | null
          total_queries: number | null
          trade: string | null
          unclear_count: number | null
          wrong_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_org_member: {
        Args: { p_email: string; p_organization_id: string }
        Returns: string
      }
      bump_question_cache_hit: { Args: { p_id: string }; Returns: undefined }
      check_and_record_ai_usage: {
        Args: {
          p_kind: string
          p_max: number
          p_user_id: string
          p_window_seconds: number
        }
        Returns: number
      }
      expire_promo_pro: { Args: never; Returns: undefined }
      is_active_org_member: {
        Args: { check_org_id: string; check_user_id: string }
        Returns: boolean
      }
      is_any_active_org_member: {
        Args: { check_user_id: string }
        Returns: boolean
      }
      is_org_owner: {
        Args: { check_org_id: string; check_user_id: string }
        Returns: boolean
      }
      link_pending_org_membership: { Args: never; Returns: undefined }
      match_cached_question: {
        Args: {
          match_organization_id: string
          match_threshold?: number
          max_age_days?: number
          query_embedding: string
        }
        Returns: {
          id: string
          response: Json
          similarity: number
        }[]
      }
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
      match_chunks_fts: {
        Args: {
          match_count?: number
          match_user_id: string
          query_text: string
        }
        Returns: {
          chunk_index: number
          clause_number: string
          clause_title: string
          content: string
          id: string
          page_number: number
          rank: number
          standard_id: string
        }[]
      }
      match_feedback_corrections: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          question_text: string
          user_comment: string
        }[]
      }
      poll_vision_batches: { Args: never; Returns: undefined }
      remove_org_member: { Args: { p_member_id: string }; Returns: undefined }
      resume_stalled_indexing: { Args: never; Returns: undefined }
      sweep_stale_processing_jobs: { Args: never; Returns: undefined }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      extraction_status: ["pending", "processing", "complete", "failed"],
      subscription_tier: ["free", "pro", "business"],
    },
  },
} as const
