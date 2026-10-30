# RAG - Sistema de Ingesta y Búsqueda de Información

Sistema de **Retrieval-Augmented Generation (RAG)** desarrollado con NestJS que permite la ingesta de documentos PDF y la búsqueda inteligente de información sobre archivos propios mediante embeddings vectoriales.

## 🎯 Objetivo

Permitir a los usuarios cargar sus propios documentos PDF y realizar consultas en lenguaje natural sobre su contenido, obteniendo respuestas precisas basadas en la información almacenada.

## 🚀 Características Principales

- **Ingesta de documentos PDF**: Procesamiento automático con división en chunks
- **Búsqueda semántica**: Uso de embeddings vectoriales con ChromaDB
- **Consultas en lenguaje natural**: Preguntas sobre el contenido de los documentos
- **Trazabilidad**: Identificación de fuentes para cada respuesta
- **Almacenamiento local**: Los archivos se guardan en una carpeta dedicada

## 🛠️ Stack Tecnológico

- **Backend**: NestJS
- **Base de datos vectorial**: 
- **Embeddings y LLM**: OpenAI
- **Procesamiento de PDF**: pdf-parse
- **Orquestación**: LangChain

## 📋 Requisitos Previos

- Node.js 18+
- API Key de OpenAI