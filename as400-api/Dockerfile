# Dockerfile para Python API AS400

FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    wget \
    locales \
    && rm -rf /var/lib/apt/lists/*

# 🔧 ENCODING FIX: Configurar locale UTF-8 para que Python y Java usen UTF-8
RUN sed -i '/es_UY.UTF-8/s/^# //g' /etc/locale.gen && \
    sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && \
    locale-gen
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV PYTHONIOENCODING=utf-8

# Copiar archivos de dependencias
COPY requirements.txt .
COPY jt400.jar .

# Instalar dependencias Python
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código fuente
COPY api_as400.py .

# Exponer puerto
EXPOSE 8000

# Variables de entorno
ENV PYTHONUNBUFFERED=1

# Comando de inicio
CMD ["python", "api_as400.py"]
