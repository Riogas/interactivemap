# 🎯 Guía de Commits con Integración Jira

## 📋 Formato de commits

Todos los commits deben incluir el **Issue Key de Jira** al inicio del mensaje.

### Formato estándar:
```
DESA-XX: Título breve del cambio

- Detalle 1
- Detalle 2
- Detalle 3
```

---

## ✅ Ejemplos de commits correctos

### Commit simple:
```bash
git commit -m "DESA-10: Implementar validación de formulario de login"
```

### Commit con descripción detallada:
```bash
git commit -m "DESA-11: Agregar filtros avanzados en panel de pedidos

- Implementado filtro por zona
- Implementado filtro por estado
- Implementado filtro por fecha
- Agregada persistencia de filtros en localStorage"
```

### Commit de fix:
```bash
git commit -m "DESA-12: Fix error 500 en endpoint de pedidos

- Corregida validación de parámetros nulos
- Agregado manejo de errores en query de Supabase
- Actualizada documentación de API"
```

### Commit de refactor:
```bash
git commit -m "DESA-13: Refactorizar componente MapView

- Extraídos componentes OptimizedMarker y OptimizedPolyline
- Implementado sistema de caché de iconos
- Mejorado rendimiento en 70%"
```

---

## 🔢 Tipos de Issue Keys

Según tu proyecto en Jira:

| Prefijo | Descripción | Ejemplo |
|---------|-------------|---------|
| `DESA-XX` | Desarrollo general | `DESA-9` |
| `BUG-XX` | Corrección de bugs | `BUG-15` |
| `FEAT-XX` | Nueva funcionalidad | `FEAT-22` |
| `DOC-XX` | Documentación | `DOC-8` |

---

## 🚀 Flujo de trabajo recomendado

### 1. Crear branch desde Jira (opcional):
```bash
git checkout -b feature/DESA-14-implementar-notificaciones
```

### 2. Hacer cambios y commits frecuentes:
```bash
# Commit 1: Primera parte
git add .
git commit -m "DESA-14: Implementar base de notificaciones

- Agregada tabla de notificaciones en Supabase
- Creado hook useNotifications
- Implementado componente NotificationBell"

# Commit 2: Segunda parte
git add .
git commit -m "DESA-14: Integrar notificaciones con realtime

- Configurada suscripción de Supabase Realtime
- Agregado sonido de notificación
- Implementado contador de no leídas"
```

### 3. Push al remoto:
```bash
git push origin feature/DESA-14-implementar-notificaciones
```

### 4. Crear Pull Request en GitHub:
- Título: `DESA-14: Implementar sistema de notificaciones`
- Descripción: Mencionar qué se hizo y cómo probar

---

## 📝 Plantillas de mensajes

### Para nuevas features:
```
DESA-XX: [Título de la feature]

Implementación:
- Feature 1
- Feature 2
- Feature 3

Testing:
- Test caso 1
- Test caso 2

Documentación:
- Archivo de documentación creado
```

### Para fixes:
```
DESA-XX: Fix [descripción del problema]

Problema:
- Descripción del bug

Solución:
- Cambio realizado

Archivos modificados:
- archivo1.ts
- archivo2.tsx
```

### Para optimizaciones:
```
DESA-XX: Optimización de [componente/funcionalidad]

Mejoras:
- Mejora 1
- Mejora 2

Resultados:
- Métrica antes: X
- Métrica después: Y
- Mejora: Z%
```

---

## 🎯 Comando rápido para commit

Agrega este alias a tu `.bashrc` o `.zshrc`:

```bash
# Commit rápido con Jira
jira-commit() {
  local issue_key=$1
  shift
  git commit -m "${issue_key}: $*"
}

# Uso:
# jira-commit DESA-15 "Implementar autenticación con Google"
```

O en PowerShell (`.ps1`):
```powershell
function Jira-Commit {
    param(
        [string]$IssueKey,
        [string]$Message
    )
    git commit -m "${IssueKey}: ${Message}"
}

# Uso:
# Jira-Commit -IssueKey "DESA-15" -Message "Implementar autenticación con Google"
```

---

## 🔗 Integración automática con Jira

Cuando uses el formato correcto (`DESA-XX:`), Jira automáticamente:

✅ **Vincula el commit al issue**  
✅ **Muestra el commit en la pestaña "Development"**  
✅ **Actualiza el estado del issue** (según configuración)  
✅ **Genera changelog automático**  

---

## ⚠️ Errores comunes

### ❌ Incorrecto:
```bash
git commit -m "fix pedidos"
git commit -m "[DESA-9] fix pedidos"
git commit -m "DESA9: fix pedidos"  # Falta el guión
```

### ✅ Correcto:
```bash
git commit -m "DESA-9: Fix error en carga de pedidos"
```

---

## 📊 Estadísticas útiles

Ver commits por issue:
```bash
git log --oneline --grep="DESA-9"
```

Ver todos los issues tocados:
```bash
git log --oneline | grep -oE "DESA-[0-9]+" | sort -u
```

Último commit de un issue:
```bash
git log --oneline --grep="DESA-9" -1
```

---

## 🎯 Checklist antes de hacer push

- [ ] El commit message empieza con `DESA-XX:`
- [ ] El issue key existe en Jira
- [ ] El mensaje es descriptivo
- [ ] Se incluyen detalles de los cambios
- [ ] El código compila sin errores
- [ ] Los tests pasan (si aplica)

---

## 📋 Ejemplo completo de este commit

```bash
# 1. Revisar cambios
git status

# 2. Agregar todos los archivos
git add .

# 3. Commit con issue key
git commit -m "DESA-9: Optimizaciones de rendimiento del mapa y actualización de lote en tiempo real

- Implementadas optimizaciones de rendimiento del mapa (React.memo, Douglas-Peucker, icon caching)
- Reducción de 70% en elementos DOM y mejora de 5x en fluidez
- Corregido filtro de fecha de pedidos (fch_hora_para vs fch_para)
- Implementada actualización de lote en tiempo real (X/Y pedidos asignados)
- Agregado debugging exhaustivo para pedidos y actualización automática
- Documentación completa de optimizaciones y nuevas funcionalidades"

# 4. Push al remoto
git push origin main
```

**Resultado:**
```
✅ Commit: d6ccb78
✅ Push exitoso
✅ Jira vinculado automáticamente
✅ Issue DESA-9 actualizado
```

---

## 🔮 Configuración avanzada

### Git hook para validar issue key:

Crea `.git/hooks/commit-msg`:

```bash
#!/bin/bash
commit_msg=$(cat "$1")

# Validar que empiece con DESA-XX:
if ! echo "$commit_msg" | grep -qE "^(DESA|BUG|FEAT|DOC)-[0-9]+:"; then
    echo "❌ Error: El commit debe empezar con un issue key (DESA-XX:)"
    echo "Ejemplo: DESA-15: Implementar nueva funcionalidad"
    exit 1
fi

echo "✅ Issue key válido"
```

Hazlo ejecutable:
```bash
chmod +x .git/hooks/commit-msg
```

---

**Fecha:** 2026-02-06  
**Archivo:** GIT_JIRA_INTEGRATION.md
