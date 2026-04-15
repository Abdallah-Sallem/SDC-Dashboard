import os
import glob
import pandas as pd
import random
import re

# Calculate absolute paths based on this script's location
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
RAW_DATA_DIR = os.path.join(WORKSPACE_ROOT, "13332134", "data")
OUTPUT_DIR = os.path.join(WORKSPACE_ROOT, "13332134", "data_french_adapted")

# We specifically want to adapt the fixations and raw files which contain stimulus text
TARGET_FILE_PATTERN = "*_fixations.csv" 

def load_french_lexicon():
    """
    In production: load a real French lexicon (e.g., Lexique383.tsv)
    For this example, we mock a robust dictionary.
    """
    return {
        # Format: length: [words...]
        2: ["le", "un", "la", "de", "en"],
        3: ["qui", "sur", "par", "est", "des"],
        4: ["chat", "loup", "dans", "pour", "tout"],
        5: ["chien", "lapin", "avant", "après", "pomme"],
        6: ["maison", "oiseau", "jardin", "garçon", "fille"],
        7: ["voiture", "chapeau", "bizarre", "couteau"],
        8: ["chocolat", "bouteille", "escalier"],
        9: ["parapluie", "téléphone"]
    }

def get_french_match(czech_word: str, lexicon: dict) -> str:
    """Finds a French word of the exact same length."""
    # Clean punctuation to get true length
    clean_word = re.sub(r'[^\w\s]', '', str(czech_word))
    target_length = len(clean_word)
    
    if target_length == 0:
        return czech_word # Keep punctuation-only tokens
        
    candidates = lexicon.get(target_length, [])
    
    matched_word = random.choice(candidates) if candidates else "X" * target_length
    
    # Re-apply any trailing punctuation (simplified)
    if not str(czech_word).isalnum():
        punctuation = str(czech_word)[len(clean_word):]
        matched_word += punctuation
        
    return matched_word

def process_dataset():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        
    lexicon = load_french_lexicon()
    search_path = os.path.join(RAW_DATA_DIR, TARGET_FILE_PATTERN)
    files = glob.glob(search_path)
    
    print(f"Found {len(files)} fixation files to adapt in {RAW_DATA_DIR}.")
    
    for filepath in files:
        filename = os.path.basename(filepath)
        df = pd.read_csv(filepath)
        
        # Determine the column name containing the Czech stimulus text
        # ETDD70 'fixations' files usually use column 'word', 'stimulus', or 'text'
        text_col = next((col for col in ['word', 'stimulus', 'text'] if col in df.columns), None)
        
        if text_col:
            # Apply feature-matched translation
            df['mapped_french_word'] = df[text_col].apply(lambda w: get_french_match(w, lexicon))
            
            # Save to new directory
            out_path = os.path.join(OUTPUT_DIR, filename)
            df.to_csv(out_path, index=False)
            print(f"Converted: {filename} -> Saved {len(df)} rows.")
        else:
            print(f"Skipped {filename}: No text column found. Existing columns: {df.columns.tolist()}")

if __name__ == "__main__":
    process_dataset()
    print(f"Dataset adaptation complete! Data written to {OUTPUT_DIR}")
    print("Ready for ml/train_etdd70_logreg.py")
